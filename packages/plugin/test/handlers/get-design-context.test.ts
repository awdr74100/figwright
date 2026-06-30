import type { GetDesignContextResult } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import { createGetDesignContextHandler } from '../../src/handlers/get-design-context.js';

const node = (over: Record<string, unknown>): SceneNode =>
  ({
    id: 'x',
    name: 'x',
    type: 'FRAME',
    visible: true,
    locked: false,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    parent: { id: 'root' },
    ...over,
  }) as unknown as SceneNode;

const fakeFigma = (opts: {
  selection?: SceneNode[];
  pageChildren?: SceneNode[];
  lookup?: Record<string, BaseNode | null>;
  variables?: Record<string, { name: string; resolvedType: string }>;
  styles?: Record<string, { name: string; type: string }>;
}): typeof figma =>
  ({
    currentPage: { selection: opts.selection ?? [], children: opts.pageChildren ?? [] },
    getNodeByIdAsync: async (id: string) => opts.lookup?.[id] ?? null,
    getStyleByIdAsync: async (id: string) => opts.styles?.[id] ?? null,
    variables: {
      getVariableByIdAsync: async (id: string) => opts.variables?.[id] ?? null,
    },
  }) as unknown as typeof figma;

describe('get_design_context handler', () => {
  it('limits depth and flags truncated nodes', async () => {
    const grandchild = node({ id: 'gc', type: 'RECTANGLE' });
    const child = node({ id: 'c', children: [grandchild] });
    const root = node({ id: 'r', children: [child] });
    const handler = createGetDesignContextHandler(fakeFigma({ selection: [root] }));

    const result = (await handler({ depth: 1, detail: 'minimal' })) as GetDesignContextResult;
    const r = result.nodes[0];
    expect(r?.id).toBe('r');
    expect(r?.children?.[0]?.id).toBe('c');
    // depth=1 stops below the child: it has children, so it is marked truncated
    expect(r?.children?.[0]?.truncated).toBe(true);
    expect(r?.children?.[0]?.children).toBeUndefined();
  });

  it('projects fields by detail level', async () => {
    const text = node({
      id: 't',
      type: 'TEXT',
      characters: 'Hi',
      fontSize: 16,
      fontName: { family: 'Inter', style: 'Bold' },
      opacity: 0.5,
    });
    const min = (await createGetDesignContextHandler(fakeFigma({ selection: [text] }))({
      detail: 'minimal',
    })) as GetDesignContextResult;
    expect(min.nodes[0]).toEqual({ id: 't', name: 'x', type: 'TEXT' });

    const compact = (await createGetDesignContextHandler(fakeFigma({ selection: [text] }))({
      detail: 'compact',
    })) as GetDesignContextResult;
    expect(compact.nodes[0]).toMatchObject({ id: 't', x: 0, y: 0, width: 10, height: 10 });
    // visible defaults to true → omitted as a no-op (only a hidden node carries the field)
    expect(compact.nodes[0]?.visible).toBeUndefined();
    expect(compact.nodes[0]?.characters).toBeUndefined();

    const full = (await createGetDesignContextHandler(fakeFigma({ selection: [text] }))({
      detail: 'full',
    })) as GetDesignContextResult;
    // P3: fontSize + fontName are deduped into a globalVars textStyle ref; characters/opacity stay inline
    expect(full.nodes[0]).toMatchObject({ characters: 'Hi', opacity: 0.5 });
    expect(full.nodes[0]?.fontSize).toBeUndefined();
    expect(full.nodes[0]?.fontName).toBeUndefined();
    const textRef = full.nodes[0]?.textStyle;
    expect(textRef).toMatch(/^text_/);
    expect(full.globalVars?.styles[textRef!]).toEqual({
      fontFamily: 'Inter',
      fontStyle: 'Bold',
      fontSize: 16,
    });
  });

  it('surfaces non-default typography — style attrs fold into the textStyle bundle, align/truncation inline', async () => {
    const text = node({
      id: 't',
      type: 'TEXT',
      characters: 'BUY NOW',
      fontSize: 14,
      fontName: { family: 'Inter', style: 'Bold' },
      lineHeight: { unit: 'PIXELS', value: 20 },
      letterSpacing: { unit: 'PERCENT', value: 5 },
      textCase: 'UPPER',
      textDecoration: 'UNDERLINE',
      textAlignHorizontal: 'CENTER',
      textAlignVertical: 'TOP', // default → omitted
      textTruncation: 'ENDING',
      maxLines: 2,
    });
    const full = (await createGetDesignContextHandler(fakeFigma({ selection: [text] }))({
      detail: 'full',
    })) as GetDesignContextResult;
    const n = full.nodes[0];

    // the shared text-style attributes are deduped into the bundle, not left inline
    expect(n?.lineHeight).toBeUndefined();
    expect(n?.textCase).toBeUndefined();
    expect(full.globalVars?.styles[n!.textStyle!]).toEqual({
      fontFamily: 'Inter',
      fontStyle: 'Bold',
      fontSize: 14,
      lineHeight: { unit: 'PIXELS', value: 20 },
      letterSpacing: { unit: 'PERCENT', value: 5 },
      textCase: 'UPPER',
      textDecoration: 'UNDERLINE',
    });
    // per-node behaviour stays inline; the TOP vertical default is dropped as noise
    expect(n?.textAlignHorizontal).toBe('CENTER');
    expect(n?.textAlignVertical).toBeUndefined();
    expect(n?.textTruncation).toBe('ENDING');
    expect(n?.maxLines).toBe(2);
  });

  it('omits no-op default typography (plain left-aligned body text stays clean)', async () => {
    const text = node({
      id: 't',
      type: 'TEXT',
      characters: 'hello',
      fontSize: 16,
      fontName: { family: 'Inter', style: 'Regular' },
      lineHeight: { unit: 'AUTO' },
      letterSpacing: { unit: 'PERCENT', value: 0 },
      textCase: 'ORIGINAL',
      textDecoration: 'NONE',
      textAlignHorizontal: 'LEFT',
      textAlignVertical: 'TOP',
      textTruncation: 'DISABLED',
      maxLines: null,
    });
    const full = (await createGetDesignContextHandler(fakeFigma({ selection: [text] }))({
      detail: 'full',
    })) as GetDesignContextResult;
    const n = full.nodes[0];

    expect(n?.lineHeight).toBeUndefined();
    expect(n?.letterSpacing).toBeUndefined();
    expect(n?.textCase).toBeUndefined();
    expect(n?.textDecoration).toBeUndefined();
    expect(n?.textAlignHorizontal).toBeUndefined();
    expect(n?.textTruncation).toBeUndefined();
    expect(n?.maxLines).toBeUndefined();
    // bundle is just the font — no default typography baked in
    expect(full.globalVars?.styles[n!.textStyle!]).toEqual({
      fontFamily: 'Inter',
      fontStyle: 'Regular',
      fontSize: 16,
    });
  });

  it('omits no-op layout defaults (visible=true / rotation=0 / opacity=1 / cornerRadius=0) but keeps real values', async () => {
    const clean = node({ id: 'clean', rotation: 0, opacity: 1, cornerRadius: 0 }); // visible true by default
    const cleanFull = (await createGetDesignContextHandler(fakeFigma({ selection: [clean] }))({
      detail: 'full',
    })) as GetDesignContextResult;
    expect(cleanFull.nodes[0]?.visible).toBeUndefined();
    expect(cleanFull.nodes[0]?.rotation).toBeUndefined();
    expect(cleanFull.nodes[0]?.opacity).toBeUndefined();
    expect(cleanFull.nodes[0]?.cornerRadius).toBeUndefined();

    const real = node({ id: 'real', visible: false, rotation: 90, opacity: 0.5, cornerRadius: 8 });
    const realFull = (await createGetDesignContextHandler(fakeFigma({ selection: [real] }))({
      detail: 'full',
    })) as GetDesignContextResult;
    expect(realFull.nodes[0]).toMatchObject({
      visible: false,
      rotation: 90,
      opacity: 0.5,
      cornerRadius: 8,
    });
  });

  it('surfaces per-run segments for a mixed-style TEXT node (fills simplified to hex), full detail only', async () => {
    const mixed = node({
      id: 'mt',
      type: 'TEXT',
      characters: 'Terms and Privacy Policy',
      fontSize: Symbol('mixed'), // non-number → the serializer marks the node mixed
      fontName: { family: 'Inter', style: 'Regular' },
      getStyledTextSegments: () => [
        {
          characters: 'Terms and ',
          start: 0,
          end: 10,
          fontName: { family: 'Inter', style: 'Regular' },
          fontSize: 14,
          fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, visible: true, opacity: 1 }],
          textDecoration: 'NONE',
          textCase: 'ORIGINAL',
        },
        {
          characters: 'Privacy Policy',
          start: 10,
          end: 24,
          fontName: { family: 'Inter', style: 'Bold' },
          fontSize: 14,
          fills: [{ type: 'SOLID', color: { r: 0, g: 0.4, b: 1 }, visible: true, opacity: 1 }],
          textDecoration: 'UNDERLINE',
          textCase: 'ORIGINAL',
        },
      ],
    });

    const full = (await createGetDesignContextHandler(fakeFigma({ selection: [mixed] }))({
      detail: 'full',
    })) as GetDesignContextResult;
    // The link span survives: its own characters, Bold style, underline, and blue colour as hex —
    // instead of the whole string collapsing to one `mixed` marker with no way to locate the link.
    expect(full.nodes[0]?.segments).toEqual([
      {
        characters: 'Terms and ',
        start: 0,
        end: 10,
        fontName: { family: 'Inter', style: 'Regular' },
        fontSize: 14,
        fills: [{ type: 'SOLID', color: '#000000' }],
        textDecoration: 'NONE',
        textCase: 'ORIGINAL',
      },
      {
        characters: 'Privacy Policy',
        start: 10,
        end: 24,
        fontName: { family: 'Inter', style: 'Bold' },
        fontSize: 14,
        fills: [{ type: 'SOLID', color: '#0066FF' }],
        textDecoration: 'UNDERLINE',
        textCase: 'ORIGINAL',
      },
    ]);

    // not surfaced below full (the hot exploration default stays lean)
    const compact = (await createGetDesignContextHandler(fakeFigma({ selection: [mixed] }))({
      detail: 'compact',
    })) as GetDesignContextResult;
    expect(compact.nodes[0]?.segments).toBeUndefined();
  });

  it('uses the selection, and throws when nothing is selected', async () => {
    const sel = node({ id: 'sel' });
    const pageNode = node({ id: 'page' });
    const withSel = (await createGetDesignContextHandler(
      fakeFigma({ selection: [sel], pageChildren: [pageNode] }),
    )({})) as GetDesignContextResult;
    expect(withSel.nodes.map(n => n.id)).toEqual(['sel']);

    // No selection and no nodeId now refuses rather than scanning the whole page.
    await expect(
      createGetDesignContextHandler(fakeFigma({ selection: [], pageChildren: [pageNode] }))({}),
    ).rejects.toThrow(/Nothing selected/);
  });

  it('dedupes repeated component instances', async () => {
    const main = { id: 'M:1' };
    const mkInstance = (id: string): SceneNode =>
      node({
        id,
        type: 'INSTANCE',
        children: [node({ id: `${id}-child`, type: 'TEXT' })],
        getMainComponentAsync: async () => main,
      });
    const handler = createGetDesignContextHandler(
      fakeFigma({ selection: [mkInstance('i1'), mkInstance('i2')] }),
    );
    const result = (await handler({
      dedupeComponents: true,
      detail: 'minimal',
    })) as GetDesignContextResult;

    expect(result.nodes[0]?.mainComponentId).toBe('M:1');
    expect(result.nodes[0]?.deduped).toBeUndefined();
    expect(result.nodes[0]?.children?.[0]?.id).toBe('i1-child');
    // second instance of the same main component is collapsed
    expect(result.nodes[1]?.deduped).toBe(true);
    expect(result.nodes[1]?.children).toBeUndefined();
  });

  it('carries per-instance textOverrides on a deduped instance (text-only, nested, skipping hidden/empty)', async () => {
    const main = { id: 'M:1' };
    // Each instance's own text differs (the whole point: card titles etc. vary per instance).
    const mkInstance = (id: string, title: string, desc: string): SceneNode =>
      node({
        id,
        type: 'INSTANCE',
        children: [
          node({ id: `${id}-title`, name: 'Title', type: 'TEXT', characters: title }),
          // nested one level deep — collector must recurse
          node({
            id: `${id}-wrap`,
            type: 'FRAME',
            children: [node({ id: `${id}-desc`, name: 'Desc', type: 'TEXT', characters: desc })],
          }),
          // hidden TEXT → skipped (doesn't render)
          node({ id: `${id}-hid`, name: 'Hidden', type: 'TEXT', characters: 'x', visible: false }),
          // empty TEXT → dropped as noise
          node({ id: `${id}-empty`, name: 'Empty', type: 'TEXT', characters: '' }),
        ],
        getMainComponentAsync: async () => main,
      });
    const result = (await createGetDesignContextHandler(
      fakeFigma({
        selection: [mkInstance('i1', 'First', 'Alpha'), mkInstance('i2', 'Second', 'Beta')],
      }),
    )({ dedupeComponents: true, detail: 'minimal' })) as GetDesignContextResult;

    // first instance expands normally and has NO textOverrides (its text is inline in children)
    expect(result.nodes[0]?.deduped).toBeUndefined();
    expect(result.nodes[0]?.textOverrides).toBeUndefined();

    // second instance is collapsed but keeps its own visible text (DFS order, nested included)
    expect(result.nodes[1]?.deduped).toBe(true);
    expect(result.nodes[1]?.children).toBeUndefined();
    expect(result.nodes[1]?.textOverrides).toEqual([
      { name: 'Title', characters: 'Second' },
      { name: 'Desc', characters: 'Beta' },
    ]);
  });

  it('carries non-text propertyOverrides on a deduped instance (recoloured / hidden child)', async () => {
    const main = { id: 'M:2' };
    const mkInstance = (id: string, titleFill: unknown, overrides: unknown[]): SceneNode =>
      node({
        id,
        type: 'INSTANCE',
        children: [
          node({
            id: `${id}-title`,
            name: 'Title',
            type: 'TEXT',
            characters: 'Plan',
            fills: titleFill,
          }),
          node({ id: `${id}-badge`, name: 'Badge', type: 'RECTANGLE', visible: id === 'p1' }),
        ],
        // Figma's native override list: instance 2 recolours its title and hides its badge.
        overrides,
        getMainComponentAsync: async () => main,
      });
    const blackFill = [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 0, g: 0, b: 0 } }];
    const blueFill = [
      { type: 'SOLID', visible: true, opacity: 1, color: { r: 0.145, g: 0.388, b: 0.922 } },
    ];
    const result = (await createGetDesignContextHandler(
      fakeFigma({
        selection: [
          mkInstance('p1', blackFill, []),
          mkInstance('p2', blueFill, [
            { id: 'p2-title', overriddenFields: ['fills'] },
            { id: 'p2-badge', overriddenFields: ['visible'] },
          ]),
        ],
      }),
    )({ dedupeComponents: true, detail: 'full' })) as GetDesignContextResult;

    // first instance expands, no overrides bag
    expect(result.nodes[0]?.deduped).toBeUndefined();
    expect(result.nodes[0]?.propertyOverrides).toBeUndefined();

    // second instance is collapsed but keeps its recoloured title + hidden badge as overrides
    expect(result.nodes[1]?.deduped).toBe(true);
    const overrides = result.nodes[1]?.propertyOverrides;
    const title = overrides?.find(o => o.name === 'Title');
    const badge = overrides?.find(o => o.name === 'Badge');
    expect((title?.fills as { color: string }[] | undefined)?.[0]?.color).toBe('#2563EB');
    expect(badge?.visible).toBe(false);
  });

  it('surfaces grounding fields (styleIds / boundVariables / componentProperties) at full detail only', async () => {
    const grounded = node({
      id: 'g',
      type: 'TEXT',
      characters: 'Hi',
      fillStyleId: 'S:fill1',
      textStyleId: 'S:text1',
      boundVariables: { fills: [{ id: 'VariableID:1' }], fontSize: { id: 'VariableID:2' } },
      componentProperties: {
        Size: { type: 'VARIANT', value: 'sm' },
        Disabled: { type: 'BOOLEAN', value: false },
      },
    });

    const full = (await createGetDesignContextHandler(fakeFigma({ selection: [grounded] }))({
      detail: 'full',
    })) as GetDesignContextResult;
    expect(full.nodes[0]).toMatchObject({
      styleIds: { fill: 'S:fill1', text: 'S:text1' },
      boundVariables: { fills: ['VariableID:1'], fontSize: ['VariableID:2'] },
      componentProperties: {
        Size: { type: 'VARIANT', value: 'sm' },
        Disabled: { type: 'BOOLEAN', value: false },
      },
    });

    // compact must not leak the full-tier grounding fields
    const compact = (await createGetDesignContextHandler(fakeFigma({ selection: [grounded] }))({
      detail: 'compact',
    })) as GetDesignContextResult;
    expect(compact.nodes[0]?.styleIds).toBeUndefined();
    expect(compact.nodes[0]?.boundVariables).toBeUndefined();
    expect(compact.nodes[0]?.componentProperties).toBeUndefined();
  });

  it('surfaces mainComponent name/key at full detail and preserves instance componentProperties through dedup', async () => {
    // Main component is a variant: `name` is the variant signature, and its parent is the
    // COMPONENT_SET whose id/name we carry so component_map can group by the set without a doc scan.
    const main = {
      id: 'M:1',
      name: 'Type=primary',
      key: 'abc123',
      parent: { id: 'CS:1', type: 'COMPONENT_SET', name: 'Button' },
    };
    const mkInstance = (id: string, variant: string): SceneNode =>
      node({
        id,
        type: 'INSTANCE',
        componentProperties: { Variant: { type: 'VARIANT', value: variant } },
        children: [node({ id: `${id}-child`, type: 'TEXT' })],
        getMainComponentAsync: async () => main,
      });
    const result = (await createGetDesignContextHandler(
      fakeFigma({ selection: [mkInstance('i1', 'primary'), mkInstance('i2', 'outline')] }),
    )({ dedupeComponents: true, detail: 'full' })) as GetDesignContextResult;

    // first instance: full main component (with its owning set) + its own variant
    expect(result.nodes[0]?.mainComponent).toEqual({
      id: 'M:1',
      name: 'Type=primary',
      key: 'abc123',
      componentSetId: 'CS:1',
      componentSetName: 'Button',
    });
    expect(result.nodes[0]?.componentProperties).toEqual({
      Variant: { type: 'VARIANT', value: 'primary' },
    });
    // second instance is deduped (children collapsed) yet KEEPS its distinct variant — the
    // constraint that lets component_map tell variants apart — and still carries the set.
    expect(result.nodes[1]?.deduped).toBe(true);
    expect(result.nodes[1]?.children).toBeUndefined();
    expect(result.nodes[1]?.componentProperties).toEqual({
      Variant: { type: 'VARIANT', value: 'outline' },
    });
    expect(result.nodes[1]?.mainComponent).toEqual({
      id: 'M:1',
      name: 'Type=primary',
      key: 'abc123',
      componentSetId: 'CS:1',
      componentSetName: 'Button',
    });
  });

  it('resolves variable + style ids to a deduped top-level token map (full detail), stripping the styleId comma', async () => {
    const a = node({
      id: 'a',
      type: 'TEXT',
      fillStyleId: 'S:text1,', // Figma trailing-comma artifact
      boundVariables: { fills: [{ id: 'VariableID:181:4147' }] },
    });
    // second node references the SAME variable — must dedupe to one map entry
    const b = node({
      id: 'b',
      type: 'TEXT',
      boundVariables: { fills: [{ id: 'VariableID:181:4147' }] },
    });

    const handler = createGetDesignContextHandler(
      fakeFigma({
        selection: [a, b],
        variables: { 'VariableID:181:4147': { name: 'Primary/500', resolvedType: 'COLOR' } },
        styles: { 'S:text1': { name: 'Body/Bold', type: 'TEXT' } },
      }),
    );
    const full = (await handler({ detail: 'full' })) as GetDesignContextResult;

    // styleId comma stripped on the node so it joins the map key
    expect(full.nodes[0]?.styleIds).toEqual({ fill: 'S:text1' });
    expect(full.variables).toEqual({
      'VariableID:181:4147': { name: 'Primary/500', type: 'COLOR' },
    });
    expect(full.styles).toEqual({ 'S:text1': { name: 'Body/Bold', type: 'TEXT' } });
  });

  it('omits token maps below full detail and when refs are unresolvable', async () => {
    const ref = node({
      id: 'r',
      type: 'TEXT',
      boundVariables: { fills: [{ id: 'VariableID:9:9' }] },
    });

    // compact: grounding fields not surfaced → no resolution
    const compact = (await createGetDesignContextHandler(
      fakeFigma({
        selection: [ref],
        variables: { 'VariableID:9:9': { name: 'X', resolvedType: 'COLOR' } },
      }),
    )({ detail: 'compact' })) as GetDesignContextResult;
    expect(compact.variables).toBeUndefined();

    // full but the lookup returns null (e.g. unsubscribed library var) → map omitted, no throw
    const full = (await createGetDesignContextHandler(
      fakeFigma({ selection: [ref], variables: {} }),
    )({ detail: 'full' })) as GetDesignContextResult;
    expect(full.variables).toBeUndefined();
    expect(full.nodes[0]?.boundVariables).toEqual({ fills: ['VariableID:9:9'] }); // raw id stays as fallback
  });

  it('resolves a nodeId root, returning empty for misses', async () => {
    const target = node({ id: '1:2' });
    const handler = createGetDesignContextHandler(
      fakeFigma({ lookup: { '1:2': target as unknown as BaseNode } }),
    );
    expect(((await handler({ nodeId: '1:2' })) as GetDesignContextResult).nodes[0]?.id).toBe('1:2');
    expect(((await handler({ nodeId: 'nope' })) as GetDesignContextResult).nodes).toEqual([]);
  });

  it('attaches a breakpoint hint when the selection spans width buckets — even at compact', async () => {
    const desktop = node({ id: 'd', name: 'W_Home', width: 1440 });
    const mobile = node({ id: 'm', name: 'M_Home', width: 375 });
    const result = (await createGetDesignContextHandler(
      fakeFigma({ selection: [desktop, mobile] }),
    )({ detail: 'compact' })) as GetDesignContextResult;

    // Fires on the grounding-free compact default — exactly where it's most needed.
    expect(result.hint).toMatch(/these are breakpoints/);
    expect(result.hint).toContain('1440 / 375');
    expect(result.hint).toMatch(/each frame/i);
    // Single screen → no pairing copy, and the "or screens" qualifier is absent.
    expect(result.hint).not.toMatch(/pair each screen/);
    expect(result.hint).not.toMatch(/across breakpoints or screens/);
    // RWD guard: grounding the frame's values must not become a hardcoded frame width.
    expect(result.hint).toMatch(/never hardcode a frame's own width/);
    expect(result.hint).toContain('no w-[375px] root');
  });

  it('leads with the pairing rule when multiple screens (more frames than buckets) are selected', async () => {
    // Two screens, each with its own desktop+mobile breakpoint → A-desktop/A-mobile + B-desktop/B-mobile.
    const result = (await createGetDesignContextHandler(
      fakeFigma({
        selection: [
          node({ id: 'ad', name: 'W_A', width: 1440 }),
          node({ id: 'am', name: 'M_A', width: 375 }),
          node({ id: 'bd', name: 'W_B', width: 1440 }),
          node({ id: 'bm', name: 'M_B', width: 375 }),
        ],
      }),
    )({})) as GetDesignContextResult;

    expect(result.hint).toContain('4 top-level frames');
    // distinct widths, widest first — not the duplicated "1440 / 375 / 1440 / 375"
    expect(result.hint).toContain('widths 1440 / 375px');
    expect(result.hint).toMatch(/pair each screen to its own breakpoint frames/);
    expect(result.hint).toMatch(/across breakpoints or screens/);
    expect(result.hint).toMatch(/never hardcode a frame's own width/);
  });

  it('does not attach the hint for same-bucket siblings, a single frame, or non-frame roots', async () => {
    // two 375 frames = a screen + its menu state, not two mobile breakpoints
    const sameBucket = (await createGetDesignContextHandler(
      fakeFigma({ selection: [node({ id: 'a', width: 375 }), node({ id: 'b', width: 390 })] }),
    )({})) as GetDesignContextResult;
    expect(sameBucket.hint).toBeUndefined();

    // single frame
    const single = (await createGetDesignContextHandler(
      fakeFigma({ selection: [node({ id: 's', width: 1440 })] }),
    )({})) as GetDesignContextResult;
    expect(single.hint).toBeUndefined();

    // one frame + one non-frame → fewer than 2 FRAMEs, no hint
    const mixedTypes = (await createGetDesignContextHandler(
      fakeFigma({
        selection: [node({ id: 'f', width: 1440 }), node({ id: 'r', type: 'RECTANGLE' })],
      }),
    )({})) as GetDesignContextResult;
    expect(mixedTypes.hint).toBeUndefined();
  });

  it('throws on invalid depth / detail / nodeId / dedupeComponents', async () => {
    const handler = createGetDesignContextHandler(fakeFigma({}));
    await expect(handler({ depth: -1 })).rejects.toThrow(/depth/);
    await expect(handler({ detail: 'huge' })).rejects.toThrow(/detail/);
    await expect(handler({ nodeId: 5 })).rejects.toThrow(/nodeId/);
    await expect(handler({ dedupeComponents: 'yes' })).rejects.toThrow(/dedupeComponents/);
  });
});
