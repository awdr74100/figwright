import type { IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';

import { ErrorCode, RpcRequestSchema, type RpcResponse } from '@figwright/shared';
import { decode, encode } from '@msgpack/msgpack';

import type { Relay } from '../relay/relay.js';

export const PING_PATH = '/ping';
export const RPC_PATH = '/rpc';
export const DEFAULT_RPC_TIMEOUT_MS = 30_000;

export interface LeaderEndpointDeps {
  relay: Relay;
  serverVersion: string;
  log?: (msg: string) => void;
  rpcTimeoutMs?: number;
}

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
  const rpcTimeoutMs = deps.rpcTimeoutMs ?? DEFAULT_RPC_TIMEOUT_MS;

  const handler = (req: IncomingMessage, res: ServerResponse): void => {
    if (req.method === 'GET' && req.url === PING_PATH) {
      writeJson(res, 200, {
        ok: true,
        serverVersion,
        plugins: relay.sessions.connected().length,
        // Lets a follower resolve the leader's current routing target once, then pin a multi-call
        // tool's sub-calls to it. Absent/undefined when no plugin is connected.
        activeSessionId: relay.pickActiveSessionId() ?? null,
      });
      return;
    }

    if (req.method === 'POST' && req.url === RPC_PATH) {
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
        try {
          const result = await relay.sendRequest(toolName, args, rpcTimeoutMs, sessionId);
          writeMsgpack(res, 200, { kind: 'ok', requestId, result });
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
