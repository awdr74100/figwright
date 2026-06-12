import type { CreateResult } from '@figwright/shared';
import { describe, expect, it, vi } from 'vitest';

import { createCombineAsVariantsHandler } from '../../src/handlers/combine-as-variants.js';

const component = (id: string, parent: unknown = { id: 'PAGE', appendChild() {} }) => ({
  id,
  type: 'COMPONENT',
  parent,
});

const fakeFigma = (
  lookup: Record<string, unknown>,
  combineAsVariants = vi.fn<() => { id: string; name: string; type: string }>(() => ({
    id: 'CS:1',
    name: 'Set',
    type: 'COMPONENT_SET',
  })),
): typeof figma =>
  ({
    getNodeByIdAsync: async (id: string) => lookup[id] ?? null,
    combineAsVariants,
  }) as unknown as typeof figma;

describe('combine_as_variants handler', () => {
  it('combines components into a set under the first component parent by default', async () => {
    const parent = { id: 'PAGE', appendChild() {} };
    const a = component('1:1', parent);
    const b = component('1:2', parent);
    const combineAsVariants = vi.fn<() => { id: string; name: string; type: string }>(() => ({
      id: 'CS:1',
      name: 'Button',
      type: 'COMPONENT_SET',
    }));
    const result = (await createCombineAsVariantsHandler(
      fakeFigma({ '1:1': a, '1:2': b }, combineAsVariants),
    )({ nodeIds: ['1:1', '1:2'], name: 'Button' })) as CreateResult;

    expect(combineAsVariants).toHaveBeenCalledWith([a, b], parent);
    expect(result).toEqual({ ok: true, nodeId: 'CS:1', name: 'Button', type: 'COMPONENT_SET' });
  });

  it('uses an explicit parentId when given', async () => {
    const explicitParent = { id: 'FR:9', appendChild() {} };
    const a = component('1:1');
    const b = component('1:2');
    const combineAsVariants = vi.fn<() => { id: string; name: string; type: string }>(() => ({
      id: 'CS:2',
      name: 'Set',
      type: 'COMPONENT_SET',
    }));
    await createCombineAsVariantsHandler(
      fakeFigma({ '1:1': a, '1:2': b, 'FR:9': explicitParent }, combineAsVariants),
    )({ nodeIds: ['1:1', '1:2'], parentId: 'FR:9' });

    expect(combineAsVariants).toHaveBeenCalledWith([a, b], explicitParent);
  });

  it('throws on <2 ids, a non-COMPONENT node, a missing node, or a bad parent', async () => {
    await expect(
      createCombineAsVariantsHandler(fakeFigma({}))({ nodeIds: ['1:1'] }),
    ).rejects.toThrow(/at least 2/);
    await expect(
      createCombineAsVariantsHandler(
        fakeFigma({ '1:1': component('1:1'), '1:2': { id: '1:2', type: 'FRAME' } }),
      )({ nodeIds: ['1:1', '1:2'] }),
    ).rejects.toThrow(/not a COMPONENT/);
    await expect(
      createCombineAsVariantsHandler(fakeFigma({ '1:1': component('1:1') }))({
        nodeIds: ['1:1', '9:9'],
      }),
    ).rejects.toThrow(/not found/);
    await expect(
      createCombineAsVariantsHandler(
        fakeFigma({ '1:1': component('1:1'), '1:2': component('1:2') }),
      )({ nodeIds: ['1:1', '1:2'], parentId: 'NOPE' }),
    ).rejects.toThrow(/parent .* not found or cannot contain/);
  });
});
