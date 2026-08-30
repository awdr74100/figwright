import type { IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';

import {
  ErrorCode,
  getRelayBudget,
  type RpcRequest,
  RpcRequestSchema,
  type RpcResponse,
} from '@figwright/shared';
import { decode, encode } from '@msgpack/msgpack';

import { hasContentType, isAllowedHost, isAllowedHttpOrigin } from '../local-access.js';
import type { Relay } from '../relay/relay.js';
import { checkWireCall, type WireRejection } from '../tools/wire-schema.js';

export const PING_PATH = '/ping';
export const RPC_PATH = '/rpc';
export const ABDICATE_PATH = '/abdicate';

/**
 * Refuse to abdicate while relay traffic is this recent, even with nothing in flight: a multi-call
 * tool has idle gaps _between_ its pinned sub-calls, and a handoff inside one of those gaps would
 * strand the remaining sub-calls on the takeover window. A stale leader with an agent actively
 * working through it steps down at the next lull instead.
 */
export const ABDICATE_QUIET_WINDOW_MS = 10_000;

export interface LeaderEndpointDeps {
  relay: Relay;
  serverVersion: string;
  /** This process's build stamp (see build-id.ts); advertised on /ping, compared on /abdicate. */
  buildId?: number;
  /**
   * Release leadership (called after an accepted /abdicate response has flushed). Wired to
   * Election.yieldLeadership in production; leaving it unset makes /abdicate answer 'unsupported',
   * which followers treat like a pre-abdication leader.
   */
  onAbdicate?: () => void;
  log?: (msg: string) => void;
  rpcTimeoutMs?: number;
  /** Test override for ABDICATE_QUIET_WINDOW_MS. */
  abdicateQuietWindowMs?: number;
}

/**
 * Check a tool call arriving over /rpc against the arguments its sandbox handler expects.
 *
 * /rpc is the one door into the relay that the MCP SDK is not standing behind. A call made in this
 * process was validated against the tool's input schema before it got here; a call that arrives
 * over HTTP was validated by whoever sent it, and the sandbox does not re-check — `dispatchSandbox
 * Message` hands `params` to the handler as `unknown`, and handlers read fields off a loose cast.
 * So for anything that is not a Figwright follower, the arguments reaching `figma.*` had been
 * checked exactly zero times. Everything else about this request is already validated: the Host,
 * the Origin, the content type, the envelope. This is the part that actually reaches the file.
 *
 * The leader answers for a name it has no schema for the same way the sandbox does — the sandbox
 * replies METHOD_NOT_FOUND for an unknown method — just one hop earlier, and without spending the
 * tool's whole relay budget to learn it.
 *
 * Two things this deliberately does not do:
 *
 * - It does not judge a caller that declares a strictly newer build. The newest build normally wins
 *   the port, but a continuously busy older leader keeps it (see ABDICATE_QUIET_WINDOW_MS), so an
 *   older leader really can be the one checking a newer follower's call. Its schemas are then the
 *   narrower ones, and rejecting on them would turn a working call into an error — a regression in
 *   exactly the reliability this is meant to protect. Enum values are where that bites: adding one
 *   is a widening the older schema cannot know about, and it has happened (`layoutMode` gained
 *   'GRID'). Ordering the two ends by the build stamp the election already ranks them by costs one
 *   optional field and removes the whole class.
 * - It does not touch the payload. Zod objects strip unknown keys, so the parsed output of a
 *   forward-compatible call is the call minus the field that made it forward-compatible. The
 *   caller's original arguments are what gets forwarded; this only decides whether to forward
 *   them.
 */
export const checkWireArgs = (req: RpcRequest, leaderBuildId: number): WireRejection | null =>
  (req.buildId ?? 0) > leaderBuildId ? null : checkWireCall(req.toolName, req.args);

const readBody = (req: IncomingMessage): Promise<Buffer> =>
  new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

const writeMsgpack = (res: ServerResponse, status: number, body: RpcResponse): void => {
  const bytes = encode(body);
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  res.writeHead(status, {
    'content-type': 'application/msgpack',
    'content-length': buf.byteLength.toString(),
  });
  res.end(buf);
};

const writeJson = (res: ServerResponse, status: number, body: unknown): void => {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(json).toString(),
  });
  res.end(json);
};

export const attachLeaderEndpoints = (http: HttpServer, deps: LeaderEndpointDeps): (() => void) => {
  const { relay, serverVersion } = deps;
  const log = deps.log ?? ((): void => {});

  const handler = (req: IncomingMessage, res: ServerResponse): void => {
    // Addressed by a name that isn't ours: DNS rebinding, where the browser thinks it is talking to
    // the attacker's domain and so both omits Origin and gets to read the reply.
    if (!isAllowedHost(req.headers.host)) {
      log(
        `[leader] refused ${req.method ?? '?'} ${req.url ?? '?'} for host ${req.headers.host ?? ''}`,
      );
      writeJson(res, 403, { error: 'forbidden host' });
      return;
    }

    // Followers reach these endpoints over Node's fetch, which sets no Origin. A request that does
    // carry one came from a page in the user's browser, which has no legitimate reason to be here.
    if (!isAllowedHttpOrigin(req.headers.origin)) {
      log(
        `[leader] refused ${req.method ?? '?'} ${req.url ?? '?'} from origin ${req.headers.origin ?? ''}`,
      );
      writeJson(res, 403, { error: 'forbidden origin' });
      return;
    }

    if (req.method === 'GET' && req.url === PING_PATH) {
      writeJson(res, 200, {
        ok: true,
        serverVersion,
        // Build stamp for newest-build-wins election; 0 marks an unbundled process (never treated
        // as newer than a real build).
        buildId: deps.buildId ?? 0,
        plugins: relay.sessions.connected().length,
        // Lets a follower resolve the leader's current routing target once, then pin a multi-call
        // tool's sub-calls to it. Absent/undefined when no plugin is connected.
        activeSessionId: relay.pickActiveSessionId() ?? null,
      });
      return;
    }

    if (req.method === 'POST' && req.url === ABDICATE_PATH) {
      if (!hasContentType(req.headers['content-type'], 'application/json')) {
        writeJson(res, 415, { ok: false, reason: 'unsupported media type' });
        return;
      }
      void (async (): Promise<void> => {
        let requesterBuildId: unknown;
        try {
          const body: unknown = JSON.parse((await readBody(req)).toString('utf8'));
          requesterBuildId =
            typeof body === 'object' && body !== null
              ? (body as { buildId?: unknown }).buildId
              : undefined;
        } catch {
          writeJson(res, 400, { ok: false, reason: 'invalid' });
          return;
        }
        if (typeof requesterBuildId !== 'number' || !Number.isFinite(requesterBuildId)) {
          writeJson(res, 400, { ok: false, reason: 'invalid' });
          return;
        }

        // Only a strictly newer build may retire this leader — the requester decided the same from
        // our /ping, so this re-check just closes the race where we were rebuilt/replaced between
        // its read and this request.
        if (requesterBuildId <= (deps.buildId ?? 0)) {
          writeJson(res, 200, { ok: false, reason: 'stale' });
          return;
        }

        if (deps.onAbdicate === undefined) {
          writeJson(res, 200, { ok: false, reason: 'unsupported' });
          return;
        }

        const quietWindowMs = deps.abdicateQuietWindowMs ?? ABDICATE_QUIET_WINDOW_MS;
        const lastRequestAt = relay.lastRequestAt();
        const busy =
          relay.pendingCount() > 0 ||
          (lastRequestAt !== 0 && Date.now() - lastRequestAt < quietWindowMs);
        if (busy) {
          writeJson(res, 200, { ok: false, reason: 'busy' });
          return;
        }

        log(`[leader] abdicating to a newer build (${requesterBuildId} > ${deps.buildId ?? 0})`);
        // Release only after the acceptance has flushed to the requester, so it knows to grab the
        // port the moment it frees — keeping the handoff gap to milliseconds.
        res.once('finish', () => deps.onAbdicate?.());
        writeJson(res, 200, { ok: true });
      })();
      return;
    }

    if (req.method === 'POST' && req.url === RPC_PATH) {
      // A media type outside the CORS simple-request set, so a cross-origin POST has to preflight —
      // and the preflight fails, because we answer no CORS headers.
      if (!hasContentType(req.headers['content-type'], 'application/msgpack')) {
        writeMsgpack(res, 415, {
          kind: 'err',
          requestId: '',
          code: ErrorCode.InvalidRequest,
          message: 'expected content-type application/msgpack',
        });
        return;
      }
      void (async (): Promise<void> => {
        let body: Buffer;
        try {
          body = await readBody(req);
        } catch (err) {
          log(`[leader] rpc body read error: ${(err as Error).message}`);
          writeJson(res, 400, { error: 'read body failed' });
          return;
        }

        let parsed: unknown;
        try {
          parsed = decode(body);
        } catch (err) {
          log(`[leader] rpc decode error: ${(err as Error).message}`);
          writeMsgpack(res, 400, {
            kind: 'err',
            requestId: '',
            code: ErrorCode.InvalidRequest,
            message: 'invalid msgpack body',
          });
          return;
        }

        const rpc = RpcRequestSchema.safeParse(parsed);
        if (!rpc.success) {
          writeMsgpack(res, 400, {
            kind: 'err',
            requestId: '',
            code: ErrorCode.InvalidParams,
            message: 'invalid rpc request',
          });
          return;
        }

        const { requestId, toolName, args, sessionId } = rpc.data;

        const rejection = checkWireArgs(rpc.data, deps.buildId ?? 0);
        if (rejection !== null) {
          log(`[leader] refused ${toolName}: ${rejection.message}`);
          writeMsgpack(res, 400, {
            kind: 'err',
            requestId,
            code: rejection.code,
            message: rejection.message,
          });
          return;
        }

        try {
          // Only the leader holds the relay, so the skew warning has to travel back with the result:
          // a follower has no other way to know which plugin build served its call. Captured as the
          // request is answered, so it names the session that actually served this one.
          let notice: string | null = null;
          // Per-tool relay budget (B + margin) by default so a heavy follower-originated call gets the
          // same headroom as a direct one; deps.rpcTimeoutMs overrides (tests).
          const result = await relay.sendRequest(
            toolName,
            // The caller's own arguments, never checkWireArgs' parsed output: parsing strips keys
            // this build does not know, which is precisely what a newer caller needs kept.
            args,
            deps.rpcTimeoutMs ?? getRelayBudget(toolName),
            sessionId,
            served => {
              notice = relay.skewNotice(served);
            },
          );
          writeMsgpack(res, 200, {
            kind: 'ok',
            requestId,
            result,
            ...(notice === null ? {} : { notice }),
          });
        } catch (err) {
          const message = (err as Error).message;
          const code =
            message.startsWith('no plugin connected') || message.startsWith('pinned session')
              ? ErrorCode.PluginDisconnected
              : message.includes('timeout')
                ? ErrorCode.Timeout
                : ErrorCode.Internal;
          writeMsgpack(res, 200, { kind: 'err', requestId, code, message });
        }
      })();
      return;
    }

    writeJson(res, 404, { error: 'not found' });
  };

  http.on('request', handler);
  return (): void => {
    http.removeListener('request', handler);
  };
};
