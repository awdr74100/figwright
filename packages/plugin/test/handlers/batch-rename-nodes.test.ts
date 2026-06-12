import type { BatchNodeResult } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import { createBatchRenameNodesHandler } from '../../src/handlers/batch-rename-nodes.js';

describe('batch_rename_nodes handler', () => {
  it('renames listed nodes and skips missing / malformed entries', async () => {
    const a = { id: '1:1', name: 'old-a' };
    const b = { id: '1:2', name: 'old-b' };
    const lookup: Record<string, unknown> = { '1:1': a, '1:2': b };
    const f = {
      getNodeByIdAsync: async (id: string) => lookup[id] ?? null,
    } as unknown as typeof figma;

    const result = (await createBatchRenameNodesHandler(f)({
      renames: [
        { nodeId: '1:1', name: 'Card' },
        { nodeId: '9:9', name: 'Ghost' },
        { nodeId: '1:2' },
        { nodeId: '1:2', name: 'Button' },
      ],
    })) as BatchNodeResult;

    expect(a.name).toBe('Card');
    expect(b.name).toBe('Button');
    expect(result).toEqual({ ok: true, affected: ['1:1', '1:2'] });
  });

  it('throws when renames is not an array', async () => {
    const f = { getNodeByIdAsync: async () => null } as unknown as typeof figma;
    await expect(createBatchRenameNodesHandler(f)({ renames: 'x' })).rejects.toThrow(/renames/);
  });
});
