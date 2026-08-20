import { ErrorCode, type RpcResponse } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import { DispatchError, dispatchTool, resolveRoutingSession } from '../src/dispatch.js';
import type { Follower } from '../src/election/follower.js';
import { portConflictMessage } from '../src/election/leader-lock.js';
import { type Node, NodeRole } from '../src/election/node.js';
import { captureSkew } from '../src/tools/skew-notice.js';

const makeNode = (overrides: Partial<Node>): Node =>
  ({
    isConflicted: () => false,
    port: 3055,
    conflictMessage: portConflictMessage(3055),
    // dispatch subscribes to role changes so a conflict declared mid-call can cut it short.
    onRoleChange: () => () => {},
    ...overrides,
  }) as unknown as Node;
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
    const node = makeNode({
      isConflicted: () => true,
      port: 3055,
      isLeader: () => false,
      conflictMessage: portConflictMessage(3055, {
        pid: 4242,
        buildId: 1,
        serverVersion: '0.4.0',
        stopped: true,
        resumed: true,
      }),
    });
    let forwarded = false;
    const follower = makeFollower({
      sendRpc: async (): Promise<RpcResponse> => {
        forwarded = true;
        return { kind: 'ok', requestId: 'r', result: null };
      },
    });

    // The election's own diagnosis is what the caller gets — dispatch never writes its own, so the
    // pid of a wedged leader reaches the agent instead of a bare timeout minutes later.
    await expect(dispatchTool({ node, follower }, 'get_document', {})).rejects.toThrow(
      /port 3055 is held by a Figwright server \(pid 4242/,
    );
    // Must NOT forward to whoever is holding the port.
    expect(forwarded).toBe(false);
  });

  it('cuts an in-flight follower call short when the election declares the port wedged', async () => {
    // The case fail-fast alone does not cover, and the common one in practice: the call is already
    // blocked on a leader that has stopped answering when the election works out why. Measured
    // before the abort existed — 123s of budget and retries, then a timeout naming nothing.
    let announce: ((role: NodeRole) => void) | undefined;
    let conflicted = false;
    const node = makeNode({
      isLeader: () => false,
      isConflicted: () => conflicted,
      conflictMessage: portConflictMessage(3055, {
        pid: 4242,
        buildId: 1,
        serverVersion: '0.4.0',
        stopped: true,
        resumed: true,
      }),
      onRoleChange: (listener: (role: NodeRole) => void) => {
        announce = listener;
        return () => {};
      },
    });
    let aborted = false;
    const follower = makeFollower({
      sendRpc: async (
        _tool: string,
        _args?: unknown,
        _requestId?: string,
        _sessionId?: string,
        _timeoutMs?: number,
        abort?: AbortSignal,
      ): Promise<RpcResponse> => {
        // A wedged leader answers nothing; only the abort can end this wait.
        await new Promise<void>(resolve => {
          abort?.addEventListener('abort', () => resolve(), { once: true });
        });
        aborted = true;
        return {
          kind: 'err',
          requestId: 'r',
          code: ErrorCode.Internal,
          message: 'follower rpc transport: This operation was aborted',
        };
      },
    });

    const call = dispatchTool({ node, follower }, 'get_document', {}, { retryDelayMs: 1 });
    await new Promise<void>(resolve => setTimeout(resolve, 10));
    conflicted = true;
    announce?.(NodeRole.Conflicted);

    await expect(call).rejects.toThrow(/pid 4242/);
    expect(aborted).toBe(true);
  });

  it('retries normally once the conflict clears, instead of reusing a spent abort', async () => {
    // The good ending, and the one the abort can silently destroy: the holder was only suspended,
    // the election woke it, and by the retry there is a working leader again. Before the controller
    // was made per-attempt, this exact sequence answered "This operation was aborted" — worse than
    // the 11s success it produced before the abort existed at all.
    let announce: ((role: NodeRole) => void) | undefined;
    let conflicted = false;
    const node = makeNode({
      isLeader: () => false,
      isConflicted: () => conflicted,
      onRoleChange: (listener: (role: NodeRole) => void) => {
        announce = listener;
        return () => {};
      },
    });

    const seen: Array<boolean | undefined> = [];
    let attempt = 0;
    const follower = makeFollower({
      sendRpc: async (
        _tool: string,
        _args?: unknown,
        _requestId?: string,
        _sessionId?: string,
        _timeoutMs?: number,
        abort?: AbortSignal,
      ): Promise<RpcResponse> => {
        attempt += 1;
        if (attempt === 1) {
          // Driven from inside the call rather than by racing timers outside it: the election
          // declares the wedge while this very request is in flight, the abort lands, and by the
          // time the retry runs the holder is answering again. Causal ordering, so a loaded
          // machine cannot reorder it.
          conflicted = true;
          announce?.(NodeRole.Conflicted);
          await new Promise<void>(resolve => {
            if (abort?.aborted === true) resolve();
            else abort?.addEventListener('abort', () => resolve(), { once: true });
          });
          seen.push(abort?.aborted);
          // SIGCONT worked: a working leader exists again before the retry is made.
          conflicted = false;
          return {
            kind: 'err',
            requestId: 'r',
            code: ErrorCode.Internal,
            message: 'follower rpc transport: This operation was aborted',
          };
        }
        // The retry must arrive with a live signal, not the spent one.
        seen.push(abort?.aborted);
        return { kind: 'ok', requestId: 'r', result: { recovered: true } };
      },
    });

    const call = dispatchTool({ node, follower }, 'get_document', {}, { retryDelayMs: 1 });

    await expect(call).resolves.toEqual({ recovered: true });
    // The retry must have arrived with a live signal, not the spent one.
    expect(seen).toEqual([true, false]);
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
