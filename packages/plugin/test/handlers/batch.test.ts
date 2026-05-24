import type { BatchResult } from '@figma-mcp-relay/shared';
import { describe, expect, it, vi } from 'vitest';

import { createBatchHandler } from '../../src/handlers/batch.js';
import { createIdempotencyCache, idempotent } from '../../src/idempotency.js';
import type { SandboxHandlers } from '../../src/dispatcher.js';
import { createRenameNodeHandler } from '../../src/handlers/rename-node.js';
import { createSetOpacityHandler } from '../../src/handlers/set-opacity.js';
import { createSetFillsHandler } from '../../src/handlers/set-fills.js';
import { createMoveNodesHandler } from '../../src/handlers/move-nodes.js';
import { createCreateFrameHandler } from '../../src/handlers/create-frame.js';
import { createDeleteNodesHandler } from '../../src/handlers/delete-nodes.js';

/** A mutable node store backing a fake figma whose getNodeByIdAsync / createFrame share one map. */
const makeFigma = (initial: Record<string, Record<string, unknown>>) => {
  const store = new Map<string, Record<string, unknown>>(Object.entries(initial));
  let seq = 100;
  const currentPage = { appendChild: vi.fn<(n: unknown) => void>() };
  const figmaCtx = {
    mixed: Symbol('mixed'),
    currentPage,
    getNodeByIdAsync: async (id: string) => store.get(id) ?? null,
    createFrame: () => {
      const id = `9:${(seq += 1)}`;
      const node: Record<string, unknown> = {
        id,
        name: 'Frame',
        type: 'FRAME',
        x: 0,
        y: 0,
        resize: vi.fn<(w: number, h: number) => void>(),
        remove: vi.fn<() => void>(() => {
          store.delete(id);
        }),
      };
      store.set(id, node);
      return node;
    },
  } as unknown as typeof figma;
  return { figmaCtx, store };
};

const realWrites = (figmaCtx: typeof figma): SandboxHandlers => ({
  rename_node: createRenameNodeHandler(figmaCtx),
  set_opacity: createSetOpacityHandler(figmaCtx),
  set_fills: createSetFillsHandler(figmaCtx),
  move_nodes: createMoveNodesHandler(figmaCtx),
  create_frame: createCreateFrameHandler(figmaCtx),
  delete_nodes: createDeleteNodesHandler(figmaCtx),
});

const SOLID = (r: number): unknown => ({ type: 'SOLID', color: { r, g: 0, b: 0 } });

describe('batch handler', () => {
  it('applies ops in order and returns one result per op', async () => {
    const { figmaCtx, store } = makeFigma({
      '1:1': { id: '1:1', name: 'A', opacity: 1 },
      '1:2': { id: '1:2', name: 'B', x: 10, y: 20 },
    });
    const handler = createBatchHandler(figmaCtx, realWrites(figmaCtx));

    const result = (await handler({
      ops: [
        { tool: 'rename_node', params: { nodeId: '1:1', name: 'renamed' } },
        { tool: 'set_opacity', params: { nodeId: '1:1', opacity: 0.5 } },
        { tool: 'move_nodes', params: { nodeIds: ['1:2'], dx: 5, dy: -5 } },
      ],
    })) as BatchResult;

    expect(result.ok).toBe(true);
    expect(result.results).toHaveLength(3);
    expect(store.get('1:1')).toMatchObject({ name: 'renamed', opacity: 0.5 });
    expect(store.get('1:2')).toMatchObject({ x: 15, y: 15 });
  });

  it('rejects a non-invertible op at validate time without mutating anything', async () => {
    const { figmaCtx, store } = makeFigma({ '1:1': { id: '1:1', name: 'A' } });
    const handler = createBatchHandler(figmaCtx, realWrites(figmaCtx));

    await expect(
      handler({
        ops: [
          { tool: 'rename_node', params: { nodeId: '1:1', name: 'renamed' } },
          { tool: 'delete_nodes', params: { nodeIds: ['1:1'] } },
        ],
      }),
    ).rejects.toThrow(/not batchable/);
    expect(store.get('1:1')).toMatchObject({ name: 'A' }); // untouched
  });

  it('aborts in the capture phase (bad node id) before any op is applied', async () => {
    const { figmaCtx, store } = makeFigma({ '1:1': { id: '1:1', name: 'A' } });
    const handler = createBatchHandler(figmaCtx, realWrites(figmaCtx));

    await expect(
      handler({
        ops: [
          { tool: 'rename_node', params: { nodeId: '1:1', name: 'renamed' } },
          { tool: 'rename_node', params: { nodeId: 'missing', name: 'x' } },
        ],
      }),
    ).rejects.toThrow(/node missing not found/);
    expect(store.get('1:1')).toMatchObject({ name: 'A' }); // first op never applied
  });

  it('rolls back already-applied mutations when a later op fails mid-apply', async () => {
    const { figmaCtx, store } = makeFigma({
      '1:1': { id: '1:1', name: 'A', opacity: 1 },
      '1:2': { id: '1:2', name: 'B', fills: [] },
    });
    const handler = createBatchHandler(figmaCtx, realWrites(figmaCtx));

    await expect(
      handler({
        ops: [
          { tool: 'rename_node', params: { nodeId: '1:1', name: 'renamed' } },
          { tool: 'set_opacity', params: { nodeId: '1:1', opacity: 0.3 } },
          // GRADIENT is rejected by set_fills at apply time → triggers rollback of the two above.
          { tool: 'set_fills', params: { nodeId: '1:2', fills: [{ type: 'GRADIENT_LINEAR' }] } },
        ],
      }),
    ).rejects.toThrow(/op 2 \(set_fills\) failed, rolled back 2/);

    expect(store.get('1:1')).toMatchObject({ name: 'A', opacity: 1 }); // both restored
  });

  it('rolls back a create by removing the node it produced', async () => {
    const { figmaCtx, store } = makeFigma({ '1:2': { id: '1:2', fills: [] } });
    const handler = createBatchHandler(figmaCtx, realWrites(figmaCtx));

    await expect(
      handler({
        ops: [
          { tool: 'create_frame', params: { name: 'New' } },
          { tool: 'set_fills', params: { nodeId: '1:2', fills: [{ type: 'GRADIENT_LINEAR' }] } },
        ],
      }),
    ).rejects.toThrow(/rolled back 1/);

    // The frame created by op 0 was the only 9:x node; rollback removed it.
    const created = [...store.keys()].filter(k => k.startsWith('9:'));
    expect(created).toHaveLength(0);
  });

  it('restores a fill on rollback', async () => {
    const { figmaCtx, store } = makeFigma({
      '1:1': { id: '1:1', fills: [SOLID(0.2)] },
      '1:2': { id: '1:2', fills: [] },
    });
    const handler = createBatchHandler(figmaCtx, realWrites(figmaCtx));

    await expect(
      handler({
        ops: [
          { tool: 'set_fills', params: { nodeId: '1:1', fills: [SOLID(0.9)] } },
          { tool: 'set_fills', params: { nodeId: '1:2', fills: [{ type: 'GRADIENT_LINEAR' }] } },
        ],
      }),
    ).rejects.toThrow(/rolled back 1/);

    expect(store.get('1:1')!.fills).toEqual([SOLID(0.2)]); // original fill restored
  });

  it('replays as a unit under idempotency: same requestId applies its ops once', async () => {
    const { figmaCtx, store } = makeFigma({ '1:2': { id: '1:2', x: 0, y: 0 } });
    const batch = idempotent(createIdempotencyCache(), createBatchHandler(figmaCtx, realWrites(figmaCtx)));
    const call = { requestId: 'r1', ops: [{ tool: 'move_nodes', params: { nodeIds: ['1:2'], dx: 10, dy: 0 } }] };

    const first = (await batch(call)) as BatchResult;
    const replay = (await batch(call)) as BatchResult;

    expect(replay).toEqual(first); // cached result returned, not re-run
    expect(store.get('1:2')).toMatchObject({ x: 10, y: 0 }); // moved once, not twice
  });

  it('validates the ops envelope', async () => {
    const { figmaCtx } = makeFigma({});
    const handler = createBatchHandler(figmaCtx, realWrites(figmaCtx));
    await expect(handler({})).rejects.toThrow(/ops must be an array/);
    await expect(handler({ ops: [] })).rejects.toThrow(/must not be empty/);
    await expect(handler({ ops: [{ params: {} }] })).rejects.toThrow(/tool must be a string/);
  });
});
