import { createToolCall, ErrorCode, isPluginBridgeMessage } from '@figma-mcp-relay/shared';
import { describe, expect, it, vi } from 'vitest';

import { dispatchSandboxMessage, type SandboxHandlers } from '../src/dispatcher.js';

describe('dispatchSandboxMessage', () => {
  it('replies with tool-result when handler resolves', async () => {
    const handlers: SandboxHandlers = {
      ping: () => ({ pong: true }),
    };
    const raw = createToolCall({ id: 'a', method: 'ping' });
    const outcome = await dispatchSandboxMessage({ raw, handlers });
    expect(outcome).toMatchObject({
      kind: 'reply',
      reply: { kind: 'tool-result', id: 'a', result: { pong: true } },
    });
  });

  it('awaits async handlers', async () => {
    const handlers: SandboxHandlers = {
      slow: async () => {
        await new Promise(resolve => setTimeout(resolve, 5));
        return 'done';
      },
    };
    const raw = createToolCall({ id: 'b', method: 'slow' });
    const outcome = await dispatchSandboxMessage({ raw, handlers });
    expect(outcome).toMatchObject({
      kind: 'reply',
      reply: { kind: 'tool-result', result: 'done' },
    });
  });

  it('replies METHOD_NOT_FOUND when method is unknown', async () => {
    const log = vi.fn<(msg: string) => void>();
    const raw = createToolCall({ id: 'c', method: 'unknown' });
    const outcome = await dispatchSandboxMessage({ raw, handlers: {}, log });
    expect(outcome).toMatchObject({
      kind: 'reply',
      reply: { kind: 'tool-error', code: ErrorCode.MethodNotFound },
    });
    expect(log).toHaveBeenCalled();
  });

  it('replies INTERNAL_ERROR when handler throws', async () => {
    const handlers: SandboxHandlers = {
      boom: () => {
        throw new Error('handler exploded');
      },
    };
    const raw = createToolCall({ id: 'd', method: 'boom' });
    const outcome = await dispatchSandboxMessage({ raw, handlers });
    expect(outcome).toMatchObject({
      kind: 'reply',
      reply: {
        kind: 'tool-error',
        code: ErrorCode.Internal,
        message: expect.stringContaining('handler exploded'),
      },
    });
  });

  it('ignores non-bridge raw messages', async () => {
    const outcome = await dispatchSandboxMessage({
      raw: { foo: 'bar' },
      handlers: { ping: () => ({}) },
    });
    expect(outcome.kind).toBe('ignore');
  });

  it('ignores result/error messages (only acts on tool-call)', async () => {
    const result = { tag: '@figma-mcp-relay/bridge', kind: 'tool-result', id: 'x', result: {} };
    expect(isPluginBridgeMessage(result)).toBe(true);
    const outcome = await dispatchSandboxMessage({
      raw: result,
      handlers: { ping: () => ({}) },
    });
    expect(outcome.kind).toBe('ignore');
  });
});
