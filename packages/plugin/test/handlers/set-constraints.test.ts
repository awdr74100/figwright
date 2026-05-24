import type { MutateResult } from '@figma-mcp-relay/shared';
import { describe, expect, it } from 'vitest';

import { createSetConstraintsHandler } from '../../src/handlers/set-constraints.js';

const fakeFigma = (lookup: Record<string, unknown>): typeof figma =>
  ({ getNodeByIdAsync: async (id: string) => lookup[id] ?? null }) as unknown as typeof figma;

describe('set_constraints handler', () => {
  it('sets horizontal/vertical constraints', async () => {
    const node = { id: '1:1', constraints: { horizontal: 'MIN', vertical: 'MIN' } };
    const handler = createSetConstraintsHandler(fakeFigma({ '1:1': node }));
    const result = (await handler({
      nodeId: '1:1',
      horizontal: 'STRETCH',
      vertical: 'CENTER',
    })) as MutateResult;
    expect(node.constraints).toEqual({ horizontal: 'STRETCH', vertical: 'CENTER' });
    expect(result).toEqual({ ok: true, nodeId: '1:1' });
  });

  it('rejects invalid constraint values and missing nodes', async () => {
    const handler = createSetConstraintsHandler(
      fakeFigma({ '1:1': { id: '1:1', constraints: { horizontal: 'MIN', vertical: 'MIN' } } }),
    );
    await expect(handler({ nodeId: '1:1', horizontal: 'WAT', vertical: 'MIN' })).rejects.toThrow(/horizontal/);
    await expect(handler({ nodeId: '9:9', horizontal: 'MIN', vertical: 'MIN' })).rejects.toThrow(/not found/);
  });
});
