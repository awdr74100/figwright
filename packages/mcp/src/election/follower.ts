import {
  ErrorCode,
  newId,
  type RpcRequest,
  type RpcResponse,
  RpcResponseSchema,
} from '@figwright/shared';
import { decode, encode } from '@msgpack/msgpack';

import { ABDICATE_PATH, PING_PATH, RPC_PATH } from './leader-endpoints.js';

export const DEFAULT_FOLLOWER_RPC_TIMEOUT_MS = 35_000;
export const DEFAULT_PING_TIMEOUT_MS = 2_000;

/** What a confirmed Figwright leader reports about itself over /ping (see leader-endpoints). */
export interface LeaderInfo {
  serverVersion: string;
  /** Build stamp of the leader's bundle; undefined on leaders that predate build ids. */
  buildId: number | undefined;
}

/**
 * Outcome of asking the leader to step down for this (newer-build) node: - 'ok' — leader accepted
 * and is releasing the port; grab it now. - 'busy' — leader has (or just had) tool traffic; retry
 * on a later tick. - 'refused' — leader says we're not actually newer; stop asking for a while. -
 * 'unsupported' — leader predates the /abdicate endpoint; only a human can retire it. - 'error' —
 * transport-level failure; treat like an unhealthy leader and let the normal dead-leader takeover
 * path handle it.
 */
export type AbdicationOutcome = 'ok' | 'busy' | 'refused' | 'unsupported' | 'error';

export type FetchFn = typeof globalThis.fetch;

export interface FollowerOptions {
  leaderUrl: string;
  rpcTimeoutMs?: number;
  pingTimeoutMs?: number;
  fetch?: FetchFn;
  log?: (msg: string) => void;
  /**
   * This process's build stamp, sent on every RPC so the leader can tell whether its own tool
   * schemas are authoritative for the call (see RpcRequestSchema.buildId). Defaults to 0, which is
   * what an unbundled process reports and the value that gets a call validated.
   */
  buildId?: number;
}

export class Follower {
  private readonly opts: Required<FollowerOptions>;

  constructor(opts: FollowerOptions) {
    this.opts = {
      leaderUrl: opts.leaderUrl,
      rpcTimeoutMs: opts.rpcTimeoutMs ?? DEFAULT_FOLLOWER_RPC_TIMEOUT_MS,
      pingTimeoutMs: opts.pingTimeoutMs ?? DEFAULT_PING_TIMEOUT_MS,
      fetch: opts.fetch ?? globalThis.fetch.bind(globalThis),
      log: opts.log ?? ((): void => {}),
      buildId: opts.buildId ?? 0,
    };
  }

  get leaderUrl(): string {
    return this.opts.leaderUrl;
  }

  /**
   * One GET /ping, parsed to the raw JSON body (or undefined on any transport/HTTP/parse failure).
   * Single source for every /ping-derived read below, so timeout and error semantics can't drift
   * between them.
   */
  private async fetchPing(): Promise<Record<string, unknown> | undefined> {
    try {
      const res = await this.opts.fetch(`${this.opts.leaderUrl}${PING_PATH}`, {
        signal: AbortSignal.timeout(this.opts.pingTimeoutMs),
      });
      if (!res.ok) return undefined;
      const body: unknown = await res.json();
      return typeof body === 'object' && body !== null
        ? (body as Record<string, unknown>)
        : undefined;
    } catch {
      return undefined;
    }
  }

  async ping(): Promise<boolean> {
    // Confirm the responder is actually a figwright leader, not some unrelated process that happens
    // to hold the port and answer 200 — otherwise this node would attach as a follower and every
    // RPC it forwards would fail. The leader's /ping returns { ok: true, serverVersion, … }.
    const body = await this.fetchPing();
    return body !== undefined && body.ok === true && typeof body.serverVersion === 'string';
  }

  /**
   * Ping(), but returning what the confirmed leader reports about itself — the election tick uses
   * the buildId to spot a stale-build leader worth challenging. undefined exactly when ping() would
   * be false, so callers can use it as the health check and the info read in one round-trip.
   */
  async leaderInfo(): Promise<LeaderInfo | undefined> {
    const body = await this.fetchPing();
    if (body === undefined || body.ok !== true || typeof body.serverVersion !== 'string') {
      return undefined;
    }
    return {
      serverVersion: body.serverVersion,
      buildId: typeof body.buildId === 'number' ? body.buildId : undefined,
    };
  }

  /**
   * Ask the leader to step down because this node runs a strictly newer build. On 'ok' the leader
   * releases the port right after its reply flushes, so the caller should immediately contend for
   * it (see Election.challengeStaleLeader).
   */
  async requestAbdication(buildId: number): Promise<AbdicationOutcome> {
    try {
      const res = await this.opts.fetch(`${this.opts.leaderUrl}${ABDICATE_PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ buildId }),
        signal: AbortSignal.timeout(this.opts.pingTimeoutMs),
      });
      // A leader that predates the endpoint 404s ("not found" catch-all) — it can't be retired
      // programmatically, only by a human killing it (ping's buildSkew message covers that).
      if (res.status === 404) return 'unsupported';
      if (!res.ok) return 'error';
      const body: unknown = await res.json();
      if (typeof body !== 'object' || body === null) return 'error';
      if ((body as { ok?: unknown }).ok === true) return 'ok';
      const reason = (body as { reason?: unknown }).reason;
      if (reason === 'busy') return 'busy';
      if (reason === 'stale') return 'refused';
      if (reason === 'unsupported') return 'unsupported';
      return 'error';
    } catch {
      return 'error';
    }
  }

  /**
   * Ask the leader which plugin session routing would currently pick, so a multi-call tool can pin
   * all its sub-calls to it. Returns undefined on any failure (no plugin, transport error,
   * malformed body) — the caller then dispatches unpinned, which is the safe pre-existing
   * behavior.
   */
  async resolveActiveSession(): Promise<string | undefined> {
    const body = await this.fetchPing();
    const id = body?.activeSessionId;
    return typeof id === 'string' ? id : undefined;
  }

  async sendRpc(
    toolName: string,
    args?: unknown,
    requestId?: string,
    sessionId?: string,
    timeoutMs?: number,
    /**
     * Cancels the request early, before its budget is up. The budget answers "how long may a
     * _working_ leader take"; this answers "we have since learned there is no leader to wait for" —
     * the election declaring the port wedged while this very call is in flight. Without it the
     * diagnosis arrives while the caller is still blocked on a leader that will never answer, and
     * the call keeps the full budget (and its retries: 40s × 3 for a default tool, measured).
     */
    abort?: AbortSignal,
  ): Promise<RpcResponse> {
    const rpc: RpcRequest = {
      requestId: requestId ?? newId(),
      toolName,
      ...(args === undefined ? {} : { args }),
      ...(sessionId === undefined ? {} : { sessionId }),
      buildId: this.opts.buildId,
    };
    const bytes = encode(rpc);
    const body = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    // Per-tool follower budget when given (outermost layer); else the constructor default. Combined
    // with the caller's abort so whichever reason arrives first ends the wait.
    const budget = AbortSignal.timeout(timeoutMs ?? this.opts.rpcTimeoutMs);
    const signal = abort === undefined ? budget : AbortSignal.any([budget, abort]);

    let res: Response;
    try {
      res = await this.opts.fetch(`${this.opts.leaderUrl}${RPC_PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/msgpack' },
        body,
        signal,
      });
    } catch (err) {
      this.opts.log(`[follower] rpc transport error: ${(err as Error).message}`);
      return {
        kind: 'err',
        requestId: rpc.requestId,
        code: ErrorCode.Internal,
        message: `follower rpc transport: ${(err as Error).message}`,
      };
    }

    const buf = new Uint8Array(await res.arrayBuffer());
    let parsed: unknown;
    try {
      parsed = decode(buf);
    } catch (err) {
      return {
        kind: 'err',
        requestId: rpc.requestId,
        code: ErrorCode.Internal,
        message: `decode leader response: ${(err as Error).message}`,
      };
    }

    const safe = RpcResponseSchema.safeParse(parsed);
    if (!safe.success) {
      return {
        kind: 'err',
        requestId: rpc.requestId,
        code: ErrorCode.Internal,
        message: 'invalid rpc response from leader',
      };
    }
    return safe.data;
  }
}
