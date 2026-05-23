import {
  createToolError,
  createToolResult,
  isPluginBridgeMessage,
  type PluginBridgeMessage,
} from '@figma-mcp-relay/shared';
import { describe, expect, it, vi } from 'vitest';

import {
  createSandboxBridge,
  type PostMessageFn,
  type SubscribeFn,
} from '../../ui/bridge/sandbox.js';

interface Harness {
  bridge: ReturnType<typeof createSandboxBridge>;
  sent: PluginBridgeMessage[];
  emit: (raw: unknown) => void;
}

const setup = (timeoutMs?: number): Harness => {
  const sent: PluginBridgeMessage[] = [];
  const emitter: { current: ((raw: unknown) => void) | null } = { current: null };
  const postMessage: PostMessageFn = msg => sent.push(msg);
  const subscribe: SubscribeFn = cb => {
    emitter.current = cb;
    return () => {
      emitter.current = null;
    };
  };
  const bridge = createSandboxBridge({
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    postMessage,
    subscribe,
  });
  return {
    bridge,
    sent,
    emit: raw => emitter.current?.(raw),
  };
};

describe('createSandboxBridge', () => {
  it('posts a tagged tool-call when handler is invoked', async () => {
    const { bridge, sent, emit } = setup();
    const promise = bridge.handler('ping', { foo: 1 });
    expect(sent).toHaveLength(1);
    expect(isPluginBridgeMessage(sent[0])).toBe(true);
    expect(sent[0]).toMatchObject({
      kind: 'tool-call',
      method: 'ping',
      params: { foo: 1 },
    });
    emit(createToolResult({ id: sent[0]!.id, result: { pong: true } }));
    await expect(promise).resolves.toEqual({ pong: true });
    expect(bridge.pendingCount()).toBe(0);
  });

  it('rejects when sandbox replies with tool-error', async () => {
    const { bridge, sent, emit } = setup();
    const promise = bridge.handler('ping', undefined);
    emit(createToolError({ id: sent[0]!.id, code: 'BOOM', message: 'sandbox failed' }));
    await expect(promise).rejects.toThrow(/BOOM: sandbox failed/);
    expect(bridge.pendingCount()).toBe(0);
  });

  it('times out when sandbox never replies', async () => {
    const { bridge } = setup(20);
    await expect(bridge.handler('ping', undefined)).rejects.toThrow(/timeout/);
  });

  it('ignores orphan replies for unknown ids', async () => {
    const log = vi.fn<(msg: string) => void>();
    const emitter: { current: ((raw: unknown) => void) | null } = { current: null };
    const bridge = createSandboxBridge({
      log,
      postMessage: () => {},
      subscribe: cb => {
        emitter.current = cb;
        return () => {
          emitter.current = null;
        };
      },
    });
    emitter.current?.(createToolResult({ id: 'never-sent', result: 1 }));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('orphan'));
    bridge.dispose();
  });

  it('ignores non-bridge messages (e.g. Figma internals)', () => {
    const { emit } = setup();
    emit({ pluginMessage: 'something else' });
    emit(undefined);
    emit({ tag: 'wrong', kind: 'tool-result', id: 'x' });
    // nothing to assert beyond no throw
    expect(true).toBe(true);
  });

  it('dispose rejects pending and unsubscribes', async () => {
    const { bridge } = setup();
    const promise = bridge.handler('ping', undefined);
    bridge.dispose();
    await expect(promise).rejects.toThrow(/disposed/);
    expect(bridge.pendingCount()).toBe(0);
  });
});
