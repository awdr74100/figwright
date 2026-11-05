import { describe, expect, it, vi } from 'vitest';

import { createSandboxHandlers } from '../src/handlers/registry.js';
import { createUndoSteps } from '../src/undo-steps.js';

/** A promise and the hand that settles it, so a test decides when a write finishes. */
const deferred = () => {
  let resolve!: (value: unknown) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<unknown>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('createUndoSteps', () => {
  it('closes one step when a write finishes, after its changes', async () => {
    const events: string[] = [];
    const step = createUndoSteps({ commitUndo: () => events.push('commit') });
    const result = await step(() => {
      events.push('write');
      return 'done';
    })({});
    expect(result).toBe('done');
    expect(events).toEqual(['write', 'commit']);
  });

  it('runs writes one at a time, so a step never holds part of another write', async () => {
    // The relay sends calls concurrently; two writes interleaving across an await would have one
    // commit close a step on half of the other.
    const events: string[] = [];
    const step = createUndoSteps({ commitUndo: () => events.push('commit') });
    const a = deferred();
    const first = step(async () => {
      events.push('a:start');
      await a.promise;
      events.push('a:end');
    })({});
    const second = step(() => {
      events.push('b');
    })({});
    await Promise.resolve();
    expect(events).toEqual(['a:start']);
    a.resolve(undefined);
    await Promise.all([first, second]);
    expect(events).toEqual(['a:start', 'a:end', 'commit', 'b', 'commit']);
  });

  it('closes the step of a write that throws, passes its error on, and keeps the queue moving', async () => {
    const commitUndo = vi.fn<() => void>();
    const step = createUndoSteps({ commitUndo });
    await expect(
      step(() => {
        throw new Error('refused');
      })({}),
    ).rejects.toThrow('refused');
    expect(await step(() => 'next')({})).toBe('next');
    expect(commitUndo).toHaveBeenCalledTimes(2);
  });

  it('never lets a failed commit replace the call’s own result or error', async () => {
    const step = createUndoSteps({
      commitUndo: () => {
        throw new Error('no undo history here');
      },
    });
    expect(await step(() => 'kept')({})).toBe('kept');
    await expect(
      step(() => {
        throw new Error('the real error');
      })({}),
    ).rejects.toThrow('the real error');
  });
});

describe('undo steps in the handler map', () => {
  const setup = () => {
    const commitUndo = vi.fn<() => void>();
    const page: Record<string, unknown> = {
      id: '0:1',
      name: 'Page',
      type: 'PAGE',
      selection: [],
      flowStartingPoints: [],
    };
    const node = { id: '1:1', name: 'Old', type: 'RECTANGLE', parent: page };
    page.children = [node];
    const figmaApi = {
      commitUndo,
      mixed: Symbol('mixed'),
      getNodeByIdAsync: async (id: string) => (id === '1:1' ? node : null),
      currentPage: page,
      root: { children: [page] },
    } as unknown as typeof figma;
    return { commitUndo, node, handlers: createSandboxHandlers(figmaApi) };
  };

  it('closes a step after each write call', async () => {
    const { commitUndo, node, handlers } = setup();
    await handlers.rename_node!({ nodeId: '1:1', name: 'A', requestId: 'r1' });
    await handlers.rename_node!({ nodeId: '1:1', name: 'B', requestId: 'r2' });
    expect(node.name).toBe('B');
    expect(commitUndo).toHaveBeenCalledTimes(2);
  });

  it('closes no step for a retry replayed from the idempotency cache, which changed nothing', async () => {
    const { commitUndo, handlers } = setup();
    await handlers.rename_node!({ nodeId: '1:1', name: 'A', requestId: 'same' });
    await handlers.rename_node!({ nodeId: '1:1', name: 'A', requestId: 'same' });
    expect(commitUndo).toHaveBeenCalledTimes(1);
  });

  it('makes a whole batch one step', async () => {
    const { commitUndo, node, handlers } = setup();
    await handlers.batch!({
      requestId: 'b1',
      ops: [
        { tool: 'rename_node', params: { nodeId: '1:1', name: 'A' } },
        { tool: 'rename_node', params: { nodeId: '1:1', name: 'B' } },
      ],
    });
    expect(node.name).toBe('B');
    expect(commitUndo).toHaveBeenCalledTimes(1);
  });

  it('closes no step for a read', async () => {
    const { commitUndo, handlers } = setup();
    // Whether this fake node serializes does not matter: a write closes its step even when it
    // throws, so a read that reaches no commit either way is what is being shown.
    await Promise.resolve(handlers.get_node!({ nodeId: '1:1' })).catch(() => {});
    expect(commitUndo).not.toHaveBeenCalled();
  });
});
