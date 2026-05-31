import {
  ErrorCode,
  newId,
  type RpcRequest,
  type RpcResponse,
  RpcResponseSchema,
} from '@figma-mcp-relay/shared';
import { decode, encode } from '@msgpack/msgpack';

import { PING_PATH, RPC_PATH } from './leader-endpoints.js';

export const DEFAULT_FOLLOWER_RPC_TIMEOUT_MS = 35_000;
export const DEFAULT_PING_TIMEOUT_MS = 2_000;

export type FetchFn = typeof globalThis.fetch;

export interface FollowerOptions {
  leaderUrl: string;
  rpcTimeoutMs?: number;
  pingTimeoutMs?: number;
  fetch?: FetchFn;
  log?: (msg: string) => void;
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
    };
  }

  get leaderUrl(): string {
    return this.opts.leaderUrl;
  }

  async ping(): Promise<boolean> {
    try {
      const res = await this.opts.fetch(`${this.opts.leaderUrl}${PING_PATH}`, {
        signal: AbortSignal.timeout(this.opts.pingTimeoutMs),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async sendRpc(toolName: string, args?: unknown, requestId?: string): Promise<RpcResponse> {
    const rpc: RpcRequest = {
      requestId: requestId ?? newId(),
      toolName,
      ...(args === undefined ? {} : { args }),
    };
    const bytes = encode(rpc);
    const body = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    let res: Response;
    try {
      res = await this.opts.fetch(`${this.opts.leaderUrl}${RPC_PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/msgpack' },
        body,
        signal: AbortSignal.timeout(this.opts.rpcTimeoutMs),
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
