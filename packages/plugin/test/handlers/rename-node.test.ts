import type { MutateResult } from '@figma-mcp-relay/shared';
import { describe, expect, it } from 'vitest';

import { createRenameNodeHandler } from '../../src/handlers/rename-node.js';

const fakeFigma = (lookup: Record<string, unknown>): typeof figma =>
  ({ getNodeByIdAsync: async (id: string) => lookup[id] ?? null }) as unknown as typeof figma;

describe('rename_node handler', () => {
  it('renames a node and returns ok + nodeId', async () => {
    const node = { id: '1:1', name: 'Old' };
    const handler = createRenameNodeHandler(fakeFigma({ '1:1': node }));
    const result = (await handler({ nodeId: '1:1', name: 'New' })) as MutateResult;
    expect(node.name).toBe('New');
    expect(result).toEqual({ ok: true, nodeId: '1:1' });
  });

  it('rejects empty name, bad input, and missing nodes', async () => {
    const handler = createRenameNodeHandler(fakeFigma({ '1:1': { id: '1:1', name: 'Old' } }));
    await expect(handler({ nodeId: '1:1', name: '' })).rejects.toThrow(/name/);
    await expect(handler({ nodeId: '1:1' })).rejects.toThrow(/name/);
    await expect(handler({ nodeId: '9:9', name: 'x' })).rejects.toThrow(/not found/);
  });
});
