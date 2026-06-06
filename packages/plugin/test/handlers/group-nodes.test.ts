import type { CreateResult } from '@figma-mcp-relay/shared';
import { describe, expect, it, vi } from 'vitest';

import { createGroupNodesHandler } from '../../src/handlers/group-nodes.js';

describe('group_nodes handler', () => {
  it('groups nodes under their shared parent and returns the new group', async () => {
    const parent = { id: '1:0', appendChild: vi.fn<() => void>() };
    const a = { id: '1:1', parent };
    const b = { id: '1:2', parent };
    const group = vi.fn<() => { id: string; name: string; type: string }>(() => ({
      id: 'G:1',
      name: 'Group 1',
      type: 'GROUP',
    }));
    const lookup: Record<string, unknown> = { '1:1': a, '1:2': b };
    const f = {
      getNodeByIdAsync: async (id: string) => lookup[id] ?? null,
      group,
    } as unknown as typeof figma;

    const result = (await createGroupNodesHandler(f)({ nodeIds: ['1:1', '1:2'] })) as CreateResult;
    expect(group).toHaveBeenCalledWith([a, b], parent);
    expect(result).toEqual({ ok: true, nodeId: 'G:1', name: 'Group 1', type: 'GROUP' });
  });

  it('throws on empty input or no groupable parent', async () => {
    const f = { getNodeByIdAsync: async () => null } as unknown as typeof figma;
    await expect(createGroupNodesHandler(f)({ nodeIds: [] })).rejects.toThrow(/non-empty/);
    await expect(createGroupNodesHandler(f)({ nodeIds: ['9:9'] })).rejects.toThrow(
      /no valid nodes/,
    );
  });
});
