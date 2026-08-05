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

  it('matches multi-word Figma axes against camelCase props', () => {
    // Figma property labels are prose ("Show icon"); code props are identifiers (`showIcon`). A
    // plain lowercase compare only ever matched single-word axes, so every multi-word property on a
    // real component was reported as a missing prop to add.
    const [m] = joinComponents(
      [
        usage({
          name: 'Button',
          variantAxes: ['Show icon', 'Is Disabled', 'icon-position', 'Full width', 'State'],
        }),
      ],
      [comp('Button', ['showIcon', 'isDisabled', 'iconPosition', 'fullWidth'])],
      { threshold: 0.7 },
    );
    expect(m?.candidate?.matchedProps).toEqual([
      'Show icon',
      'Is Disabled',
      'icon-position',
      'Full width',
    ]);
    expect(m?.candidate?.unmatchedProps).toEqual(['State']); // genuinely absent — still reported
  });

  it('does not match a name to an unrelated one in another script', () => {
    // Regression: an [a-z0-9] casefold reduced BOTH of these to '', and diceSimilarity('','')
    // short-circuits to 1 — so a Chinese "按鈕" was a confident, high-status match for a Japanese
    // "ボタン", or for any other non-Latin component that happened to be scanned.
    const jp: ScannedComponent = {
      name: 'ボタン',
      filePath: 'src/components/ボタン.vue',
      exportKind: 'default',
      propNames: [],
      propsExtracted: true,
      framework: 'vue',
    };
    const [m] = joinComponents([usage({ name: '按鈕' })], [jp], { threshold: 0.7 });
    expect(m?.status).toBe('unmapped');
    expect(m?.candidate).toBeUndefined();
  });

  it('matches an accented Figma name to its ASCII code identifier', () => {
    const [m] = joinComponents([usage({ name: 'Café' })], [comp('Cafe')], { threshold: 0.7 });
    expect(m?.candidate?.name).toBe('Cafe');
    expect(m?.candidate?.confidence).toBe(1);
  });

  it('matches components and axes named in a non-Latin script', () => {
    // An [a-z0-9] casefold erases a CJK name entirely, so every such component compared as the
    // empty string and could only ever match an exact duplicate.
    const cjk: ScannedComponent = {
      name: '按鈕',
      filePath: 'src/components/按鈕.vue',
      exportKind: 'default',
      propNames: ['尺寸', '是否停用'],
      propsExtracted: true,
      framework: 'vue',
    };
    const [m] = joinComponents(
      [usage({ name: '按鈕/主要', variantAxes: ['尺寸', '是否停用'] })],
      [cjk],
      { threshold: 0.7 },
    );
    expect(m?.candidate?.name).toBe('按鈕');
    expect(m?.status).toBe('high');
    expect(m?.candidate?.matchedProps).toEqual(['尺寸', '是否停用']);
  });

  it('reports proven matches off an incomplete prop list, but claims nothing is missing', () => {
    // A component whose own props parsed but whose base/prop-type is imported has propsExtracted
    // false with a PARTIAL propNames. The two halves aren't symmetric: a prop we did read still
    // matches, while the axes we can't account for may well be covered by the props we couldn't
    // see — calling those missing would be a false extension TODO.
    const partial: ScannedComponent = {
      name: 'Button',
      filePath: 'src/app/button.component.ts',
      exportKind: 'named',
      propNames: ['size'],
      propsExtracted: false,
      framework: 'angular',
    };
    const [m] = joinComponents(
      [usage({ name: 'Button', variantAxes: ['Size', 'Tone'] })],
      [partial],
      { threshold: 0.7 },
    );
    expect(m?.candidate?.matchedProps).toEqual(['Size']);
    expect(m?.candidate?.unmatchedProps).toEqual([]);
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

  // Figma writes a variant's own name as `Prop=Value, …`, so the text before the first `=` is a
  // PROPERTY name — and Size / State / Type / Variant are exactly what a design system also names
  // components. Mining it mapped an unresolved variant usage onto an unrelated component at 1.0.
  it.each(['Size=Large, State=Hover', 'Type=Primary', 'State=Default, Size=Medium'])(
    'does not mine a component name out of the variant decoration in %s',
    name => {
      const ds = [comp('Size'), comp('State'), comp('Type'), comp('Button')];
      const [m] = joinComponents([usage({ name })], ds, { threshold: 0.7 });
      expect(m?.status).not.toBe('high');
      expect(m?.candidate?.confidence ?? 0).toBeLessThan(0.85);
    },
  );

  // The slash part carries the real name, and a comma-only name has no variant syntax at all —
  // neither may be lost to the rule above.
  it.each(['Button/Size=Large, State=Hover', 'Button/Primary', 'Button, Large'])(
    'still recovers the component name from %s',
    name => {
      const ds = [comp('Button'), comp('Card'), comp('Size')];
      const [m] = joinComponents([usage({ name })], ds, { threshold: 0.7 });
      expect(m?.candidate?.name).toBe('Button');
      expect(m?.status).toBe('high');
    },
  );

  it('honours a threshold raised above the absolute high mark', () => {
    const scanned2 = [comp('Button')];
    const at = (threshold: number) =>
      joinComponents([usage({ name: 'Buton' })], scanned2, { threshold })[0];
    expect(at(0.7)?.status).toBe('high'); // 0.889 — confident by default
    expect(at(0.95)?.status).toBe('low'); // …but below a caller who asked for 0.95
    expect(at(0.95)?.candidate?.name).toBe('Button'); // still surfaced, just not reuse-grade
  });

  it('flags unmapped when nothing is close', () => {
    const [m] = joinComponents([usage({ name: 'Tooltip' })], scanned, { threshold: 0.7 });
    expect(m?.status).toBe('unmapped');
    expect(m?.candidate).toBeUndefined();
  });

  it('surfaces a near-tie runner-up on ambiguousWith and never presents it as a confident high', () => {
    // A real casing split: NavBar.tsx + Navbar.tsx both normalize to "navbar", so both match a Figma
    // "NavBar" identically — the fuzzy join can't confidently pick one.
    const twins = [comp('NavBar'), comp('Navbar')]; // distinct files, same normalized name
    const [m] = joinComponents([usage({ name: 'NavBar' })], twins, { threshold: 0.7 });
    // The winning pick is unchanged (first scanned), but the runner-up is surfaced for verification.
    expect(m?.candidate?.name).toBe('NavBar');
    expect(m?.candidate?.ambiguousWith).toEqual([
      { name: 'Navbar', filePath: 'src/components/Navbar.tsx' },
    ]);
    // Score 1 would be 'high' — the tie caps it to 'medium' so codegen treats it as verify-me.
    expect(m?.status).toBe('medium');
  });

  it('does not flag a distant runner-up (below the tie epsilon)', () => {
    // Card matches cleanly; Avatar/Button are far off → not ambiguous, so full high, no ambiguousWith.
    const [m] = joinComponents([usage({ name: 'Card' })], scanned, { threshold: 0.7 });
    expect(m?.status).toBe('high');
    expect(m?.candidate?.ambiguousWith).toBeUndefined();
  });

  it('caps the surfaced runner-ups instead of dumping a long list', () => {
    // Five identically-normalized siblings → only the top MAX_AMBIGUOUS (3) runner-ups are surfaced.
    const sibs = ['NavBar', 'Navbar', 'NAVBAR', 'Nav_Bar', 'Nav-Bar'].map(n => comp(n));
    const [m] = joinComponents([usage({ name: 'NavBar' })], sibs, { threshold: 0.7 });
    expect(m?.candidate?.ambiguousWith).toHaveLength(3);
  });

  it('trusts an override whose file is on disk even when the scan did not parse it', () => {
    // The scanner can miss a real component (an unusual export). The override still wins at full
    // confidence — but only because the tool confirmed the file is on disk (overridesOnDisk).
    const overrides = new Map([['Tooltip', { name: 'Tip', filePath: 'src/ui/Tip.tsx' }]]);
    const [m] = joinComponents([usage({ name: 'Tooltip' })], scanned, {
      threshold: 0.7,
      overrides,
      overridesOnDisk: new Set(['Tooltip']),
    });
    expect(m?.candidate?.name).toBe('Tip');
    expect(m?.candidate?.confidence).toBe(1);
    expect(m?.source).toBe('map-file');
    expect(m?.staleOverride).toBeUndefined();
  });

  it('degrades a stale override (target neither scanned nor on disk) and flags it', () => {
    // The recorded file was deleted/renamed. Honouring it would emit an import of a dead module —
    // strictly worse than the fuzzy fallback — so it degrades (here to unmapped) and reports the
    // dead row for cleanup instead of asserting a phantom high-confidence reuse.
    const overrides = new Map([['Tooltip', { name: 'Tip', filePath: 'src/ui/Tip.tsx' }]]);
    const [m] = joinComponents([usage({ name: 'Tooltip' })], scanned, {
      threshold: 0.7,
      overrides,
    });
    expect(m?.status).toBe('unmapped');
    expect(m?.source).toBe('scan');
    expect(m?.staleOverride).toEqual({ name: 'Tip', filePath: 'src/ui/Tip.tsx' });
  });

  it('a stale override still recovers the fuzzy match when one exists (better than a phantom)', () => {
    // Button IS in the scan; the stale row pointed elsewhere. Degrading recovers the real Button
    // instead of importing the dead target — the whole point of not blindly trusting the row.
    const overrides = new Map([['Button', { name: 'Gone', filePath: 'src/ui/Gone.tsx' }]]);
    const [m] = joinComponents([usage({ name: 'Button' })], scanned, { threshold: 0.7, overrides });
    expect(m?.candidate?.name).toBe('Button');
    expect(m?.source).toBe('scan');
    expect(m?.staleOverride).toEqual({ name: 'Gone', filePath: 'src/ui/Gone.tsx' });
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

  it('does not mistake a data row for the header (whole-cell header match)', () => {
    // A figma name that merely contains "figma", pointed at a path with a header-ish word, must NOT
    // be dropped as a header — the earlier substring check silently swallowed exactly this row.
    const md = [
      '| Figma | Code |', // real header — skipped
      '| :---: | :--- |', // aligned separator — skipped
      '| Figma/Logo | src/brand/Component.tsx |', // data row that trips a substring check
    ].join('\n');
    const map = parseMapFile(md);
    expect(map.get('Figma/Logo')?.filePath).toBe('src/brand/Component.tsx');
    expect(map.has('Figma')).toBe(false); // the actual header still skipped
    expect([...map.keys()].some(k => k.startsWith(':'))).toBe(false); // separator skipped
  });
});
