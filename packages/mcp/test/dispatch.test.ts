import { ErrorCode, type RpcResponse } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import { DispatchError, dispatchTool, resolveRoutingSession } from '../src/dispatch.js';
import type { Follower } from '../src/election/follower.js';
import type { Node } from '../src/election/node.js';
import { captureSkew } from '../src/tools/skew-notice.js';

const makeNode = (overrides: Partial<Node>): Node =>
  ({ isConflicted: () => false, port: 3055, ...overrides }) as unknown as Node;
const makeFollower = (overrides: Partial<Follower>): Follower => overrides as unknown as Follower;

describe('dispatchTool', () => {
  it('routes to Relay.sendRequest when local node is leader', async () => {
    const calls: Array<{ name: string; args: unknown }> = [];
    const node = makeNode({
      isLeader: () => true,
      getLeader: () =>
        ({
          relay: {
            skewNotice: () => null,
            sendRequest: async (name: string, args: unknown) => {
              calls.push({ name, args });
              return { from: 'leader-relay', echoed: args };
            },
          },
          http: undefined as never,
          port: 0,
        }) as unknown as ReturnType<Node['getLeader']>,
    });
    const follower = makeFollower({});

    const result = await dispatchTool({ node, follower }, 'my_tool', { x: 1 });
    expect(result).toEqual({ from: 'leader-relay', echoed: { x: 1 } });
    expect(calls).toEqual([{ name: 'my_tool', args: { x: 1 } }]);
  });

  it('fails fast with an actionable error when the node is port-conflicted', async () => {
    const node = makeNode({ isConflicted: () => true, port: 3055, isLeader: () => false });
    let forwarded = false;
    const follower = makeFollower({
      sendRpc: async (): Promise<RpcResponse> => {
        forwarded = true;
        return { kind: 'ok', requestId: 'r', result: null };
      },
    });

    await expect(dispatchTool({ node, follower }, 'get_document', {})).rejects.toThrow(
      /port 3055 is held by a non-Figwright process/,
    );
    // Must NOT forward to the squatter holding the port.
    expect(forwarded).toBe(false);
  });

  it('routes to Follower.sendRpc when local node is not leader', async () => {
    const node = makeNode({ isLeader: () => false, getLeader: () => null });
    let received: { tool: string; args: unknown } | null = null;
    const follower = makeFollower({
      sendRpc: async (tool: string, args?: unknown): Promise<RpcResponse> => {
        received = { tool, args };
        return { kind: 'ok', requestId: 'r', result: { from: 'follower' } };
      },
    });

    const result = await dispatchTool({ node, follower }, 'remote_tool', { y: 2 });
    expect(result).toEqual({ from: 'follower' });
    expect(received).toEqual({ tool: 'remote_tool', args: { y: 2 } });
  });

  it('warns on the leader path, attributed to the session that served the call', async () => {
    // Not the session that is most-active *now*: with two files open on different plugin builds
    // those differ, and a warning pinned to the wrong plugin is worse than no warning.
    const asked: (string | undefined)[] = [];
    const node = makeNode({
      isLeader: () => true,
      getLeader: () =>
        ({
          relay: {
            // Models the real relay's timing: the answer arrives on a socket event (a macrotask
            // away), and onServed fires only after that await — inside sendRequest's own async
            // context. A fake that called onServed synchronously hid a live bug where the callback
            // ran in the socket's context and reached nobody.
            sendRequest: async (
              _tool: string,
              _args: unknown,
              _timeout?: number,
              _sessionId?: string,
              onServed?: (served: string | undefined) => void,
            ): Promise<unknown> => {
              await new Promise(resolve => setTimeout(resolve, 0));
              onServed?.('sess-that-served');
              return { ok: true };
            },
            skewNotice: (id?: string) => {
              asked.push(id);
              return id === 'sess-that-served' ? 'plugin v0.3.0 is older than this server' : null;
            },
          },
          http: undefined as never,
          port: 0,
        }) as unknown as ReturnType<Node['getLeader']>,
    });
    let seen: string | null = null;

    await captureSkew(
      async () => {
        await dispatchTool({ node, follower: makeFollower({}) }, 'set_fills', {});
        return { content: [] };
      },
      (result, notice) => {
        seen = notice;
        return result;
      },
    );

    expect(asked).toEqual(['sess-that-served']);
    expect(seen).toMatch(/older than this server/);
  });

  it('carries the leader’s skew warning back to a follower', async () => {
    // Only the leader holds the relay, so a follower has no way of its own to know which plugin
    // build served the call. Without this the warning would reach some users and not others,
    // depending on which process happened to win the election.
    const node = makeNode({ isLeader: () => false, getLeader: () => null });
    const follower = makeFollower({
      sendRpc: async (): Promise<RpcResponse> => ({
        kind: 'ok',
        requestId: 'r',
        result: { ok: true },
        notice: 'Figwright plugin v0.3.0 is older than this server (v0.4.0).',
      }),
    });
    let seen: string | null = null;

    await captureSkew(
      async () => {
        await dispatchTool({ node, follower }, 'set_fills', {});
        return { content: [] };
      },
      (result, notice) => {
        seen = notice;
        return result;
      },
    );

    expect(seen).toMatch(/older than this server/);
  });

  it('reports no skew when the leader attaches none', async () => {
    const node = makeNode({ isLeader: () => false, getLeader: () => null });
    const follower = makeFollower({
      sendRpc: async (): Promise<RpcResponse> => ({ kind: 'ok', requestId: 'r', result: {} }),
    });
    let seen: string | null = 'unset';

    await captureSkew(
      async () => {
        await dispatchTool({ node, follower }, 'set_fills', {});
        return { content: [] };
      },
      (result, notice) => {
        seen = notice;
        return result;
      },
    );

    expect(seen).toBeNull();
  });

  it('throws DispatchError immediately on non-transient follower error', async () => {
    const node = makeNode({ isLeader: () => false, getLeader: () => null });
    const follower = makeFollower({
      sendRpc: async (): Promise<RpcResponse> => ({
        kind: 'err',
        requestId: 'r',
        code: ErrorCode.InvalidParams,
        message: 'bad input',
      }),
    });

    await expect(dispatchTool({ node, follower }, 'x', undefined)).rejects.toMatchObject({
      name: 'DispatchError',
      code: ErrorCode.InvalidParams,
      message: 'bad input',
    });
  });

  it('retries transient follower transport error and eventually succeeds', async () => {
    const node = makeNode({ isLeader: () => false, getLeader: () => null });
    let attempts = 0;
    const follower = makeFollower({
      sendRpc: async (): Promise<RpcResponse> => {
        attempts += 1;
        if (attempts < 2) {
          return {
            kind: 'err',
            requestId: 'r',
            code: ErrorCode.Internal,
            message: 'follower rpc transport: ECONNREFUSED',
          };
        }
        return { kind: 'ok', requestId: 'r', result: { ok: 'after-retry' } };
      },
    });

    const result = await dispatchTool({ node, follower }, 'x', {}, { retryDelayMs: 5 });
    expect(result).toEqual({ ok: 'after-retry' });
    expect(attempts).toBe(2);
  });

  it('retries a "relay stopping" rejection (leader shutting down / abdicating) and recovers', async () => {
    const node = makeNode({ isLeader: () => false, getLeader: () => null });
    let attempts = 0;
    const follower = makeFollower({
      sendRpc: async (): Promise<RpcResponse> => {
        attempts += 1;
        if (attempts < 2) {
          return {
            kind: 'err',
            requestId: 'r',
            code: ErrorCode.Internal,
            message: 'relay stopping (pending get_document)',
          };
        }
        // By the retry the new leader owns the port and serves the call.
        return { kind: 'ok', requestId: 'r', result: { from: 'new-leader' } };
      },
    });

    const result = await dispatchTool({ node, follower }, 'get_document', {}, { retryDelayMs: 5 });
    expect(result).toEqual({ from: 'new-leader' });
    expect(attempts).toBe(2);
  });

  it('switches from follower to leader path when role changes mid-retry', async () => {
    let attempts = 0;
    const leaderResult = { from: 'new-leader' };
    const node = makeNode({
      isLeader: () => attempts >= 1,
      getLeader: () =>
        attempts >= 1
          ? ({
              relay: {
                skewNotice: () => null,
                sendRequest: async (): Promise<unknown> => leaderResult,
              },
              http: undefined as never,
              port: 0,
            } as unknown as ReturnType<Node['getLeader']>)
          : null,
    });
    const follower = makeFollower({
      sendRpc: async (): Promise<RpcResponse> => {
        attempts += 1;
        return {
          kind: 'err',
          requestId: 'r',
          code: ErrorCode.Internal,
          message: 'follower rpc transport: fetch failed',
        };
      },
    });

    const result = await dispatchTool({ node, follower }, 'x', {}, { retryDelayMs: 5 });
    expect(result).toBe(leaderResult);
    expect(attempts).toBe(1);
  });

  it('exhausts retries and throws when transient persists', async () => {
    const node = makeNode({ isLeader: () => false, getLeader: () => null });
    let attempts = 0;
    const follower = makeFollower({
      sendRpc: async (): Promise<RpcResponse> => {
        attempts += 1;
        return {
          kind: 'err',
          requestId: 'r',
          code: ErrorCode.Internal,
          message: 'follower rpc transport: ECONNREFUSED',
        };
      },
    });

    await expect(
      dispatchTool({ node, follower }, 'x', {}, { retryDelayMs: 1, maxAttempts: 2 }),
    ).rejects.toBeInstanceOf(DispatchError);
    expect(attempts).toBe(2);
  });

  it('threads opts.sessionId into Relay.sendRequest on the leader path', async () => {
    let pinned: string | undefined = 'unset';
    const node = makeNode({
      isLeader: () => true,
      getLeader: () =>
        ({
          relay: {
            skewNotice: () => null,
            sendRequest: async (_n: string, _a: unknown, _t?: number, sessionId?: string) => {
              pinned = sessionId;
              return { ok: true };
            },
          },
          http: undefined as never,
          port: 0,
        }) as unknown as ReturnType<Node['getLeader']>,
    });
    await dispatchTool({ node, follower: makeFollower({}) }, 'x', {}, { sessionId: 'sess-7' });
    expect(pinned).toBe('sess-7');
  });

  it('threads opts.sessionId into Follower.sendRpc on the follower path', async () => {
    let pinned: string | undefined = 'unset';
    const node = makeNode({ isLeader: () => false, getLeader: () => null });
    const follower = makeFollower({
      sendRpc: async (
        _t: string,
        _a?: unknown,
        _r?: string,
        sessionId?: string,
      ): Promise<RpcResponse> => {
        pinned = sessionId;
        return { kind: 'ok', requestId: 'r', result: {} };
      },
    });
    await dispatchTool({ node, follower }, 'x', {}, { sessionId: 'sess-9' });
    expect(pinned).toBe('sess-9');
  });
});

describe('resolveRoutingSession', () => {
  it('resolves locally from the relay when leader', async () => {
    const node = makeNode({
      isLeader: () => true,
      getLeader: () =>
        ({
          relay: { pickActiveSessionId: () => 'leader-sess' },
          http: undefined as never,
          port: 0,
        }) as unknown as ReturnType<Node['getLeader']>,
    });
    expect(await resolveRoutingSession({ node, follower: makeFollower({}) })).toBe('leader-sess');
  });

  it('asks the leader over the follower when not leader', async () => {
    const node = makeNode({ isLeader: () => false, getLeader: () => null });
    const follower = makeFollower({ resolveActiveSession: async () => 'remote-sess' });
    expect(await resolveRoutingSession({ node, follower })).toBe('remote-sess');
  });
});
