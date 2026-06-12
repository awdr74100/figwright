import type { DesignContextNode } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import {
  collectFigmaComponents,
  diceSimilarity,
  type FigmaComponentUsage,
  joinComponents,
  parseMapFile,
} from '../../src/join/component-map.js';
import type { ScannedComponent } from '../../src/scan/scan.js';

const comp = (name: string, propNames: string[] = []): ScannedComponent => ({
  name,
  filePath: `src/components/${name}.tsx`,
  exportKind: 'named',
  propNames,
  propsExtracted: true,
  framework: 'react',
});

const usage = (over: Partial<FigmaComponentUsage> & { name: string }): FigmaComponentUsage => ({
  variantAxes: [],
  instances: [{ nodeId: '1:1' }],
  instanceCount: 1,
  ...over,
});

describe('diceSimilarity', () => {
  it('is 1 for identical and 0 for disjoint', () => {
    expect(diceSimilarity('button', 'button')).toBe(1);
    expect(diceSimilarity('button', 'xyzwq')).toBeLessThan(0.2);
  });
  it('scores near-matches highly', () => {
    expect(diceSimilarity('button', 'buttons')).toBeGreaterThan(0.8);
  });
});

describe('joinComponents', () => {
  const scanned = [comp('Button', ['size', 'variant']), comp('Card'), comp('Avatar')];

  it('maps an exact name as high confidence', () => {
    const [m] = joinComponents([usage({ name: 'Button' })], scanned, { threshold: 0.7 });
    expect(m?.candidate?.name).toBe('Button');
    expect(m?.candidate?.confidence).toBe(1);
    expect(m?.status).toBe('high');
    expect(m?.source).toBe('scan');
  });

  it('strips Figma variant/slash decoration before matching', () => {
    const [m] = joinComponents([usage({ name: 'Button/Primary' })], scanned, { threshold: 0.7 });
    expect(m?.candidate?.name).toBe('Button');
    expect(m?.status).toBe('high');
  });

  it('rewards variant axes that match code props, recording them', () => {
    const [m] = joinComponents(
      [usage({ name: 'Buton', variantAxes: ['Size', 'Variant'] })], // typo'd name → imperfect
      scanned,
      { threshold: 0.7 },
    );
    expect(m?.candidate?.name).toBe('Button');
    expect(m?.candidate?.matchedProps).toEqual(['Size', 'Variant']);
  });

  it('reports Figma axes the candidate lacks as unmatchedProps (extension TODOs)', () => {
    const [m] = joinComponents(
      [usage({ name: 'Button', variantAxes: ['Size', 'Variant', 'Show icon_L', 'State'] })],
      scanned, // Button props: size, variant
      { threshold: 0.7 },
    );
    expect(m?.candidate?.matchedProps).toEqual(['Size', 'Variant']);
    expect(m?.candidate?.unmatchedProps).toEqual(['Show icon_L', 'State']);
  });

  it('diffs props on the override path too, resolving the scanned component', () => {
    const overrides = new Map([['btn', { name: 'Button', filePath: 'src/components/Button.tsx' }]]);
    const [m] = joinComponents(
      [usage({ name: 'btn', variantAxes: ['Size', 'Show icon_L'] })],
      scanned, // Button at src/components/Button.tsx, props: size, variant
      { threshold: 0.7, overrides },
    );
    expect(m?.source).toBe('map-file');
    expect(m?.candidate?.matchedProps).toEqual(['Size']);
    expect(m?.candidate?.unmatchedProps).toEqual(['Show icon_L']);
  });

  it('suppresses unmatchedProps when the candidate props were not extracted (SFC baseline)', () => {
    // A Vue/Svelte component whose props couldn't be parsed has propsExtracted=false. The join must
    // not dump every variant axis into unmatchedProps (a false "extend this component" TODO) just
    // because the prop list is unknown.
    const vue: ScannedComponent = {
      name: 'Button',
      filePath: 'src/components/Button.vue',
      exportKind: 'default',
      propNames: [],
      propsExtracted: false,
      framework: 'vue',
    };
    const [m] = joinComponents(
      [usage({ name: 'Button', variantAxes: ['Size', 'Variant'] })],
      [vue],
      { threshold: 0.7 },
    );
    expect(m?.candidate?.name).toBe('Button');
    expect(m?.candidate?.matchedProps).toEqual([]);
    expect(m?.candidate?.unmatchedProps).toEqual([]);
  });

  it('flags unmapped when nothing is close', () => {
    const [m] = joinComponents([usage({ name: 'Tooltip' })], scanned, { threshold: 0.7 });
    expect(m?.status).toBe('unmapped');
    expect(m?.candidate).toBeUndefined();
  });

  it('lets a map-file override win with full confidence', () => {
    const overrides = new Map([['Tooltip', { name: 'Tip', filePath: 'src/ui/Tip.tsx' }]]);
    const [m] = joinComponents([usage({ name: 'Tooltip' })], scanned, {
      threshold: 0.7,
      overrides,
    });
    expect(m?.candidate?.name).toBe('Tip');
    expect(m?.candidate?.confidence).toBe(1);
    expect(m?.source).toBe('map-file');
  });
});

describe('collectFigmaComponents', () => {
  it('groups repeated instances by main component, unioning variant axes', () => {
    const tree: DesignContextNode = {
      id: '0:1',
      name: 'Page',
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
          name: 'Button',
          type: 'INSTANCE',
          mainComponent: { id: 'c1', name: 'Button', key: 'k1' },
          mainComponentId: 'c1',
          componentProperties: { State: { type: 'VARIANT', value: 'hover' } },
        },
      ],
    };
    const [u] = collectFigmaComponents([tree]);
    expect(u?.name).toBe('Button');
    expect(u?.instanceCount).toBe(2);
    expect(u?.instances).toEqual([
      { nodeId: '1:1', props: { Size: 'sm' } },
      { nodeId: '1:2', props: { State: 'hover' } },
    ]);
    expect(u?.variantAxes).toEqual(['Size', 'State']);
  });

  it('groups variant instances by the set carried on mainComponent — no setIndex needed', () => {
    // Each variant's mainComponent.name is the variant signature, but componentSetName/Id carry the
    // owning set (now resolved by get_design_context). Two distinct variant ids must still collapse
    // into one usage named after the set, with the set id as the group id.
    const tree: DesignContextNode = {
      id: '0:1',
      name: 'Page',
      type: 'FRAME',
      children: [
        {
          id: '1:1',
          name: 'btn',
          type: 'INSTANCE',
          mainComponent: {
            id: 'v1',
            name: 'Size=Large',
            key: 'k1',
            componentSetId: 'set1',
            componentSetName: 'Button',
          },
          mainComponentId: 'v1',
        },
        {
          id: '1:2',
          name: 'btn',
          type: 'INSTANCE',
          mainComponent: {
            id: 'v2',
            name: 'Size=Small',
            key: 'k2',
            componentSetId: 'set1',
            componentSetName: 'Button',
          },
          mainComponentId: 'v2',
        },
      ],
    };
    const usages = collectFigmaComponents([tree]);
    expect(usages).toHaveLength(1);
    expect(usages[0]?.name).toBe('Button');
    expect(usages[0]?.mainComponentId).toBe('set1');
    expect(usages[0]?.instanceCount).toBe(2);
  });

  it('merges the same component across sibling top-level frames into one usage', () => {
    // Whole-page scans pass multiple top-level frames. The same component (same set) used in two
    // frames must collapse to ONE usage with the instances from both — not one usage per frame.
    const frame = (frameId: string, instId: string): DesignContextNode => ({
      id: frameId,
      name: 'Frame',
      type: 'FRAME',
      children: [
        {
          id: instId,
          name: 'btn',
          type: 'INSTANCE',
          mainComponent: {
            id: 'v1',
            name: 'Size=Large',
            key: 'k',
            componentSetId: 'set1',
            componentSetName: 'Button',
          },
          mainComponentId: 'v1',
        },
      ],
    });
    const usages = collectFigmaComponents([frame('F:1', '1:1'), frame('F:2', '2:1')]);
    expect(usages).toHaveLength(1);
    expect(usages[0]?.name).toBe('Button');
    expect(usages[0]?.instanceCount).toBe(2);
    expect(usages[0]?.instances.map(i => i.nodeId)).toEqual(['1:1', '2:1']);
  });
});

describe('parseMapFile', () => {
  it('parses arrow lines and markdown table rows, skipping the header', () => {
    const md = [
      '| Figma | Code |',
      '| --- | --- |',
      '| Tooltip | src/ui/Tip.tsx |',
      'Badge -> src/ui/Badge.tsx',
    ].join('\n');
    const map = parseMapFile(md);
    expect(map.get('Tooltip')?.name).toBe('Tip');
    expect(map.get('Tooltip')?.filePath).toBe('src/ui/Tip.tsx');
    expect(map.get('Badge')?.name).toBe('Badge');
    expect(map.has('Figma')).toBe(false);
  });
});
