import type { GetLocalComponentsResult } from '@figma-mcp-relay/shared';
import { describe, expect, it } from 'vitest';

import { createGetLocalComponentsHandler } from '../../src/handlers/get-local-components.js';

const fakeFigma = (found: unknown[]): typeof figma => {
  let loaded = false;
  return {
    loadAllPagesAsync: async () => {
      loaded = true;
    },
    root: {
      children: [{ id: 'page-1' }],
      findAllWithCriteria: () => {
        if (!loaded) throw new Error('must loadAllPagesAsync first');
        return found;
      },
    },
  } as unknown as typeof figma;
};

describe('get_local_components handler', () => {
  it('splits components and component sets, with variant metadata', async () => {
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
    const handler = createGetLocalComponentsHandler(fakeFigma([set, standalone, variant]));
    const result = (await handler(undefined)) as GetLocalComponentsResult;

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

  it('loads all pages before scanning and returns empty when none found', async () => {
    const result = (await createGetLocalComponentsHandler(fakeFigma([]))(
      undefined,
    )) as GetLocalComponentsResult;
    expect(result).toEqual({ components: [], componentSets: [] });
  });
});
