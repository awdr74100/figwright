import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { GetDesignContextResult, GetLocalComponentsResult } from '@figma-mcp-relay/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  COMPONENT_MAP_TOOL_NAME,
  handleComponentMap,
  type ToolDispatcher,
} from '../../src/tools/component-map.js';
import { GET_DESIGN_CONTEXT_TOOL_NAME } from '../../src/tools/get-design-context.js';
import { GET_LOCAL_COMPONENTS_TOOL_NAME } from '../../src/tools/get-local-components.js';

const noLocalComponents: GetLocalComponentsResult = { components: [], componentSets: [] };

const fakeContext: GetDesignContextResult = {
  nodes: [
    {
      id: '0:1',
      name: 'Screen',
      type: 'FRAME',
      children: [
        {
          id: '1:1',
          name: 'Button',
          type: 'INSTANCE',
          mainComponent: { id: 'c1', name: 'Button', key: 'k1' },
          mainComponentId: 'c1',
          componentProperties: { Size: { type: 'VARIANT', value: 'sm' } },
        },
        {
          id: '1:2',
          name: 'Tooltip',
          type: 'INSTANCE',
          mainComponent: { id: 'c2', name: 'Tooltip', key: 'k2' },
          mainComponentId: 'c2',
        },
      ],
    },
  ],
};

describe('handleComponentMap', () => {
  let dir: string;
  const dispatch: ToolDispatcher = async tool => {
    if (tool === GET_DESIGN_CONTEXT_TOOL_NAME) return fakeContext;
    if (tool === GET_LOCAL_COMPONENTS_TOOL_NAME) return noLocalComponents;
    throw new Error(`unexpected dispatch: ${tool}`);
  };

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'compmap-test-'));
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({ dependencies: { react: '^19.0.0' }, devDependencies: { typescript: '^5' } }),
    );
    await mkdir(join(dir, 'src', 'components'), { recursive: true });
    await writeFile(
      join(dir, 'src', 'components', 'Button.tsx'),
      'export function Button({ size }) { return <button/>; }',
    );
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('maps Button to the scanned component and flags Tooltip unmapped', async () => {
    const result = await handleComponentMap(dispatch, { rootDir: dir });
    const button = result.mappings.find(m => m.figmaComponentName === 'Button');
    const tooltip = result.mappings.find(m => m.figmaComponentName === 'Tooltip');

    expect(button?.candidate?.name).toBe('Button');
    expect(button?.status).toBe('high');
    expect(button?.candidate?.matchedProps).toEqual(['Size']);
    expect(tooltip?.status).toBe('unmapped');
    expect(result.unmapped).toContain('Tooltip');
    expect(result.profile.framework).toBe('react');
    expect(result.scannedComponentCount).toBe(1);
  });

  it('honors a docs/figma-component-map.md override for the otherwise-unmapped component', async () => {
    await mkdir(join(dir, 'docs'), { recursive: true });
    await writeFile(join(dir, 'docs', 'figma-component-map.md'), 'Tooltip -> src/ui/Tip.tsx\n');
    const result = await handleComponentMap(dispatch, { rootDir: dir });
    const tooltip = result.mappings.find(m => m.figmaComponentName === 'Tooltip');
    expect(tooltip?.candidate?.name).toBe('Tip');
    expect(tooltip?.source).toBe('map-file');
    expect(result.unmapped).not.toContain('Tooltip');
  });

  it('groups variant instances by their component set, not the variant name', async () => {
    // Figma resolves a variant instance's mainComponent to the variant ("Size=Large, State=Hover"),
    // whose name fuzzy-matches nothing. get_local_components supplies the set, so the usage is named
    // "btn/Default" — which is also what the override file keys on.
    const variantContext: GetDesignContextResult = {
      nodes: [
        {
          id: '0:1',
          name: 'Screen',
          type: 'FRAME',
          children: [
            {
              id: '1:1',
              name: 'btn/Default',
              type: 'INSTANCE',
              mainComponent: { id: 'v1', name: 'Size=Large, State=Hover', key: 'k1' },
              mainComponentId: 'v1',
              componentProperties: { Size: { type: 'VARIANT', value: 'Large' } },
            },
            {
              id: '1:2',
              name: 'btn/Default',
              type: 'INSTANCE',
              mainComponent: { id: 'v2', name: 'Size=Small, State=Default', key: 'k2' },
              mainComponentId: 'v2',
              componentProperties: { Size: { type: 'VARIANT', value: 'Small' } },
            },
          ],
        },
      ],
    };
    const localComponents: GetLocalComponentsResult = {
      components: [],
      componentSets: [
        { id: 'set1', name: 'btn/Default', key: 'sk', description: '', componentIds: ['v1', 'v2'] },
      ],
    };
    const variantDispatch: ToolDispatcher = async tool => {
      if (tool === GET_DESIGN_CONTEXT_TOOL_NAME) return variantContext;
      if (tool === GET_LOCAL_COMPONENTS_TOOL_NAME) return localComponents;
      throw new Error(`unexpected dispatch: ${tool}`);
    };

    await writeFile(
      join(dir, 'docs', 'figma-component-map.md'),
      'btn/Default -> src/components/Button.tsx\n',
    );
    const result = await handleComponentMap(variantDispatch, { rootDir: dir });

    // Two variant instances collapse into ONE usage named after the set, not two variant rows.
    const btn = result.mappings.filter(m => m.figmaComponentName === 'btn/Default');
    expect(btn).toHaveLength(1);
    expect(btn[0]?.instanceCount).toBe(2);
    expect(btn[0]?.instanceNodeIds).toEqual(['1:1', '1:2']);
    // The override keyed on the set name now fires.
    expect(btn[0]?.source).toBe('map-file');
    expect(btn[0]?.candidate?.name).toBe('Button');
  });

  it('exposes a stable tool name', () => {
    expect(COMPONENT_MAP_TOOL_NAME).toBe('component_map');
  });
});
