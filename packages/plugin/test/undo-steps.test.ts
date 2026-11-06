import { describe, expect, it, vi } from 'vitest';

import { createSandboxHandlers } from '../src/handlers/registry.js';
import { createUndoSteps, STALE_WRITE_MS } from '../src/undo-steps.js';

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
  it('closes a step when a write finishes, after its changes', async () => {
    const events: string[] = [];
    const step = createUndoSteps({ commitUndo: () => events.push('commit') });
    const result = await step(() => {
      events.push('write');
      return 'done';
    })({});
    expect(result).toBe('done');
    expect(events).toEqual(['write', 'commit']);
  });

  it('closes one step per write when they come one after another', async () => {
    const events: string[] = [];
    const step = createUndoSteps({ commitUndo: () => events.push('commit') });
    await step(() => events.push('a'))({});
    await step(() => events.push('b'))({});
    expect(events).toEqual(['a', 'commit', 'b', 'commit']);
  });

  it('never commits while another write is mid-way, so a step never holds half of one', async () => {
    // The relay sends calls concurrently; a commit as the first finished would have closed a step on
    // the part of the second written so far.
    const events: string[] = [];
    const step = createUndoSteps({ commitUndo: () => events.push('commit') });
    const a = deferred();
    const b = deferred();
    const first = step(async () => {
      events.push('a:start');
      await a.promise;
      events.push('a:end');
    })({});
    const second = step(async () => {
      events.push('b:start');
      await b.promise;
      events.push('b:end');
    })({});
    a.resolve(undefined);
    await first;
    expect(events).toEqual(['a:start', 'b:start', 'a:end']);
    b.resolve(undefined);
    await second;
    expect(events).toEqual(['a:start', 'b:start', 'a:end', 'b:end', 'commit']);
  });

  it('makes no write wait for another', async () => {
    // Queueing them made fifteen 2.5 s writes sent together run in turn until the last four timed out
    // (measured); overlapping writes now run as they did before any of this.
    const step = createUndoSteps({ commitUndo: () => {} });
    const slow = deferred();
    void step(() => slow.promise)({});
    expect(await step(() => 'ran')({})).toBe('ran');
    slow.resolve(undefined);
  });

  it('closes the step of a write that throws and passes its error on', async () => {
    const commitUndo = vi.fn<() => void>();
    const step = createUndoSteps({ commitUndo });
    await expect(
      step(() => {
        throw new Error('refused');
      })({}),
    ).rejects.toThrow('refused');
    expect(commitUndo).toHaveBeenCalledTimes(1);
  });

  it('stops counting a write stuck for STALE_WRITE_MS, so it cannot hold the others\u2019 step open', async () => {
    // A create_instance by key hung in FigJam (measured); counted forever, it would have kept every
    // later write's step from closing.
    vi.useFakeTimers();
    try {
      const events: string[] = [];
      const step = createUndoSteps({ commitUndo: () => events.push('commit') });
      const stuck = deferred();
      const first = step(async () => {
        await stuck.promise;
        events.push('stuck:end');
        return 'late';
      })({});
      await step(() => events.push('during'))({});
      expect(events).toEqual(['during']);

      await vi.advanceTimersByTimeAsync(STALE_WRITE_MS);
      expect(events).toEqual(['during', 'commit']);
      await step(() => events.push('after'))({});
      expect(events).toEqual(['during', 'commit', 'after', 'commit']);

      // Finishing later it closes no step — that would cut some other write's in two — and its
      // caller still gets its result.
      stuck.resolve(undefined);
      expect(await first).toBe('late');
      expect(events.at(-1)).toBe('stuck:end');
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
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
