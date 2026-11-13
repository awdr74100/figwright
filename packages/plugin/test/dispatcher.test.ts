import { ErrorCode } from '@figwright/shared';
import { describe, expect, it, vi } from 'vitest';

import { createToolCall, isPluginBridgeMessage } from '../protocol/bridge.js';
import {
  dispatchSandboxMessage,
  markWriteHandler,
  type SandboxHandlers,
} from '../src/dispatcher.js';
import { isRuntimeSpent, resetRuntimeForTests } from '../src/runtime-ids.js';

describe('dispatchSandboxMessage', () => {
  it('replies with tool-result when handler resolves', async () => {
    const handlers: SandboxHandlers = {
      ping: () => ({ pong: true }),
    };
    const raw = createToolCall({ id: 'a', method: 'ping' });
    const outcome = await dispatchSandboxMessage({ raw, handlers, editorType: 'figma' });
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
    const outcome = await dispatchSandboxMessage({ raw, handlers, editorType: 'figma' });
    expect(outcome).toMatchObject({
      kind: 'reply',
      reply: { kind: 'tool-result', result: 'done' },
    });
  });

  it('replies METHOD_NOT_FOUND when method is unknown', async () => {
    const log = vi.fn<(msg: string) => void>();
    const raw = createToolCall({ id: 'c', method: 'unknown' });
    const outcome = await dispatchSandboxMessage({ raw, handlers: {}, editorType: 'figma', log });
    expect(outcome).toMatchObject({
      kind: 'reply',
      reply: { kind: 'tool-error', code: ErrorCode.MethodNotFound },
    });
    expect(log).toHaveBeenCalled();
  });

  it.each(['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty'])(
    'replies METHOD_NOT_FOUND for the inherited property name %s, never running it',
    async method => {
      // The handler table is a plain object, so indexing it by a name it does not own reaches
      // Object.prototype: `constructor` would run `Object(params)` and answer ok.
      const handlers: SandboxHandlers = { ping: () => ({ pong: true }) };
      const raw = createToolCall({ id: 'p', method });
      const outcome = await dispatchSandboxMessage({ raw, handlers, editorType: 'figma' });
      expect(outcome).toMatchObject({
        kind: 'reply',
        reply: { kind: 'tool-error', code: ErrorCode.MethodNotFound },
      });
    },
  );

  it('replies INTERNAL_ERROR when handler throws', async () => {
    const handlers: SandboxHandlers = {
      boom: () => {
        throw new Error('handler exploded');
      },
    };
    const raw = createToolCall({ id: 'd', method: 'boom' });
    const outcome = await dispatchSandboxMessage({ raw, handlers, editorType: 'figma' });
    expect(outcome).toMatchObject({
      kind: 'reply',
      reply: {
        kind: 'tool-error',
        code: ErrorCode.Internal,
        message: expect.stringContaining('handler exploded'),
      },
    });
  });

  // FigJam and Dev Mode reject whole classes of call the tool surface offers, and the plugin API's
  // own error rarely says which editor raised it. Naming it is what lets an agent re-plan instead
  // of retrying the same call — see protocol/editor-context.ts.
  it('names the editor when a handler throws in a restricted one', async () => {
    const handlers: SandboxHandlers = {
      boom: () => {
        throw new Error('in read-only mode');
      },
    };
    const raw = createToolCall({ id: 'e', method: 'boom' });

    const outcome = await dispatchSandboxMessage({ raw, handlers, editorType: 'dev' });

    expect(outcome).toMatchObject({
      kind: 'reply',
      reply: {
        kind: 'tool-error',
        message: expect.stringContaining('in read-only mode'),
      },
    });
    expect((outcome as { reply: { message: string } }).reply.message).toContain('editor: dev');
  });

  // Dev Mode refuses every write, so a write refused for its own arguments first still names it;
  // a read that fails for its own reasons does not.
  it('names Dev Mode on any error from a handler marked as a write, and not from a read', async () => {
    const fail = (): never => {
      throw new Error('node 9:999 not found');
    };
    const handlers: SandboxHandlers = { write: markWriteHandler(fail), read: () => fail() };
    const reply = async (method: string) =>
      (
        (await dispatchSandboxMessage({
          raw: createToolCall({ id: method, method }),
          handlers,
          editorType: 'dev',
        })) as { reply: { message: string } }
      ).reply.message;

    expect(await reply('write')).toContain('(editor: dev — ');
    expect(await reply('read')).toBe('node 9:999 not found');
  });

  // Measured: Figma's own "check your internet connection" came and went with the network fine,
  // on calls it answers from its server — a lookup of a deleted id among them.
  it.each([
    'Unable to establish connection to Figma after 10 seconds. Please check your internet connection.',
    'batch: op 1 (set_fills) failed, rolled back 0/1 op(s); 1 undo(s) FAILED [op 0 (group_nodes): Unable to establish connection to Figma after 10 seconds. Please check your internet connection.]',
  ])('says what Figma\u2019s server timeout means, keeping its own words: %s', async raised => {
    const handlers: SandboxHandlers = {
      lookup: () => {
        throw new Error(raised);
      },
    };
    const outcome = (await dispatchSandboxMessage({
      raw: createToolCall({ id: 's', method: 'lookup' }),
      handlers,
      editorType: 'figma',
    })) as { reply: { code: string; message: string } };

    // A timeout — Figma's own 10 s ran out — not a fault in the plugin.
    expect(outcome.reply.code).toBe(ErrorCode.Timeout);
    expect(outcome.reply.message.startsWith(raised)).toBe(true);
    expect(outcome.reply.message).toContain("(Figma's server did not answer. Despite the wording");
    expect(outcome.reply.message.match(/Figma's server did not answer/g)).toHaveLength(1);
  });

  // Measured in Figma desktop: once the runtime's callback slots are spent (grid-tracks.ts), every
  // later read that needs one fails with this, and only reopening the plugin recovers.
  it('says that spent callback slots need the plugin reopened, keeping Figma’s own words', async () => {
    const raised = 'in <unknown>: Attempted to invoke callback with invalid id -32767';
    const handlers: SandboxHandlers = {
      lookup: () => {
        throw new Error(raised);
      },
    };
    const outcome = (await dispatchSandboxMessage({
      raw: createToolCall({ id: 's', method: 'lookup' }),
      handlers,
      editorType: 'figma',
    })) as { reply: { code: string; message: string } };

    expect(outcome.reply.code).toBe(ErrorCode.Internal);
    expect(outcome.reply.message.startsWith(raised)).toBe(true);
    expect(outcome.reply.message).toContain('reopen the plugin');
    // Whichever handler meets the overflow first marks the session for the rest (runtime-ids.ts).
    expect(isRuntimeSpent()).toBe(true);
    resetRuntimeForTests();
  });

  // Figma Design is the common case, and it must stay free of the caveat entirely.
  it('adds nothing to an error raised in Figma Design', async () => {
    const handlers: SandboxHandlers = {
      boom: () => {
        throw new Error('handler exploded');
      },
    };
    const raw = createToolCall({ id: 'f', method: 'boom' });

    const outcome = await dispatchSandboxMessage({ raw, handlers, editorType: 'figma' });

    expect((outcome as { reply: { message: string } }).reply.message).toBe('handler exploded');
    expect((outcome as { reply: { code: string } }).reply.code).toBe(ErrorCode.Internal);
  });

  it('ignores non-bridge raw messages', async () => {
    const outcome = await dispatchSandboxMessage({
      raw: { foo: 'bar' },
      handlers: { ping: () => ({}) },
      editorType: 'figma',
    });
    expect(outcome.kind).toBe('ignore');
  });

  it('ignores result/error messages (only acts on tool-call)', async () => {
    const result = { tag: '@figwright/bridge', kind: 'tool-result', id: 'x', result: {} };
    expect(isPluginBridgeMessage(result)).toBe(true);
    const outcome = await dispatchSandboxMessage({
      raw: result,
      handlers: { ping: () => ({}) },
      editorType: 'figma',
    });
    expect(outcome.kind).toBe('ignore');
  });
});
