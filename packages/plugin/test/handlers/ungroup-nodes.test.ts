import type { BatchNodeResult } from '@figma-mcp-relay/shared';
import { describe, expect, it, vi } from 'vitest';

import { createUngroupNodesHandler } from '../../src/handlers/ungroup-nodes.js';

describe('ungroup_nodes handler', () => {
  it('ungroups GROUP nodes and returns the promoted children ids; skips non-groups', async () => {
    const ungroup = vi.fn<() => { id: string }[]>(() => [{ id: '1:1' }, { id: '1:2' }]);
    const lookup: Record<string, unknown> = {
      'G:1': { id: 'G:1', type: 'GROUP' },
      '5:5': { id: '5:5', type: 'FRAME' },
    };
    const f = {
      getNodeByIdAsync: async (id: string) => lookup[id] ?? null,
      ungroup,
    } as unknown as typeof figma;

    const result = (await createUngroupNodesHandler(f)({
      nodeIds: ['G:1', '5:5', '9:9'],
    })) as BatchNodeResult;
    expect(ungroup).toHaveBeenCalledOnce();
    expect(result).toEqual({ ok: true, affected: ['1:1', '1:2'] });
  });

  it('throws on bad input', async () => {
    const f = { getNodeByIdAsync: async () => null } as unknown as typeof figma;
    await expect(createUngroupNodesHandler(f)({ nodeIds: 'x' })).rejects.toThrow(/nodeIds/);
  });
});
