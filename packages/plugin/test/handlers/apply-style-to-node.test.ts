import type { MutateResult } from '@figwright/shared';
import { describe, expect, it, vi } from 'vitest';

import { createApplyStyleToNodeHandler } from '../../src/handlers/apply-style-to-node.js';

const fakeFigma = (node: unknown): typeof figma =>
  ({ getNodeByIdAsync: async () => node }) as unknown as typeof figma;

describe('apply_style_to_node handler', () => {
  it('calls the matching async style setter for the field', async () => {
    const setFillStyleIdAsync = vi.fn<() => Promise<void>>(async () => {});
    const node = { id: '1:1', setFillStyleIdAsync };
    const handler = createApplyStyleToNodeHandler(fakeFigma(node));
    const result = (await handler({
      nodeId: '1:1',
      styleId: 'S:0',
      field: 'fill',
    })) as MutateResult;

    expect(setFillStyleIdAsync).toHaveBeenCalledWith('S:0');
    expect(result).toEqual({ ok: true, nodeId: '1:1' });
  });

  it('throws on bad field, missing node, or unsupported setter', async () => {
    const node = { id: '1:1' };
    await expect(
      createApplyStyleToNodeHandler(fakeFigma(node))({
        nodeId: '1:1',
        styleId: 'S:0',
        field: 'fill',
      }),
    ).rejects.toThrow(/cannot take/);
    await expect(
      createApplyStyleToNodeHandler(fakeFigma(node))({
        nodeId: '1:1',
        styleId: 'S:0',
        field: 'bogus',
      }),
    ).rejects.toThrow(/field must be/);
    await expect(
      createApplyStyleToNodeHandler(fakeFigma(null))({
        nodeId: '9:9',
        styleId: 'S:0',
        field: 'fill',
      }),
    ).rejects.toThrow(/not found/);
  });
});
