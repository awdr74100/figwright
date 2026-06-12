import type { GetLocalComponentsResult } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import { createGetLocalComponentsHandler } from '../../src/handlers/get-local-components.js';

// A container node (frame) whose findAllWithCriteria returns the components/sets in its subtree.
const frame = (id: string, found: unknown[]): unknown => ({
  id,
  type: 'FRAME',
  findAllWithCriteria: () => found,
});

const fakeFigma = (opts: {
  selection?: unknown[];
  lookup?: Record<string, unknown>;
}): typeof figma =>
  ({
    currentPage: { selection: opts.selection ?? [] },
    getNodeByIdAsync: async (id: string) => opts.lookup?.[id] ?? null,
  }) as unknown as typeof figma;

const set = {
  type: 'COMPONENT_SET',
  id: 'CS:1',
  name: 'Button',
  key: 'csk',
  description: 'btn',
  variantGroupProperties: {
    Size: { values: ['S', 'L'] },
    State: { values: ['Default', 'Hover'] },
  },
  children: [{ id: 'C:1' }, { id: 'C:2' }],
};
const standalone = {
  type: 'COMPONENT',
  id: 'C:3',
  name: 'Icon',
  key: 'ck3',
  description: '',
  parent: { id: 'P:1' },
  variantProperties: null,
};
const variant = {
  type: 'COMPONENT',
  id: 'C:1',
  name: 'Size=S, State=Default',
  key: 'ck1',
  description: '',
  parent: { id: 'CS:1' },
  variantProperties: { Size: 'S', State: 'Default' },
};

describe('get_local_components handler', () => {
  it('splits components and component sets within the selection subtree, with variant metadata', async () => {
    const handler = createGetLocalComponentsHandler(
      fakeFigma({ selection: [frame('F:1', [set, standalone, variant])] }),
    );
    const result = (await handler({})) as GetLocalComponentsResult;

    expect(result.componentSets).toHaveLength(1);
    expect(result.componentSets[0]).toMatchObject({
      id: 'CS:1',
      componentIds: ['C:1', 'C:2'],
      variantGroupProperties: { Size: { values: ['S', 'L'] } },
    });
    expect(result.components.map(c => c.id)).toEqual(['C:3', 'C:1']);
    expect(result.components.find(c => c.id === 'C:3')?.variantProperties).toBeUndefined();
    expect(result.components.find(c => c.id === 'C:1')?.variantProperties).toEqual({
      Size: 'S',
      State: 'Default',
    });
  });

  it('scopes to an explicit nodeId', async () => {
    const handler = createGetLocalComponentsHandler(
      fakeFigma({ lookup: { 'F:9': frame('F:9', [standalone]) } }),
    );
    const result = (await handler({ nodeId: 'F:9' })) as GetLocalComponentsResult;
    expect(result.components.map(c => c.id)).toEqual(['C:3']);
    expect(result.componentSets).toEqual([]);
  });

  it('dedupes a component found via overlapping roots', async () => {
    const handler = createGetLocalComponentsHandler(
      fakeFigma({ selection: [frame('F:1', [standalone]), frame('F:2', [standalone])] }),
    );
    const result = (await handler({})) as GetLocalComponentsResult;
    expect(result.components.map(c => c.id)).toEqual(['C:3']);
  });

  it('throws when nothing is selected and no nodeId is given', async () => {
    await expect(createGetLocalComponentsHandler(fakeFigma({ selection: [] }))({})).rejects.toThrow(
      /Nothing selected/,
    );
  });
});
