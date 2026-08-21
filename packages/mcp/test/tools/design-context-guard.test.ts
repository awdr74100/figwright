import {
  DESIGN_CONTEXT_CHAR_BUDGET,
  type DesignContextNode,
  type GetDesignContextResult,
} from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import {
  handleDesignContext,
  sectionPlanFromPayload,
  type ToolDispatcher,
} from '../../src/tools/design-context-guard.js';

const leaf = (id: string, extra: Record<string, unknown> = {}): DesignContextNode => ({
  id,
  name: `n-${id}`,
  type: 'RECTANGLE',
  ...extra,
});

/** A dispatcher returning a fixed payload while capturing the args it was handed. */
const dispatcher = (
  payload: GetDesignContextResult,
): { dispatch: ToolDispatcher; seen: unknown[] } => {
  const seen: unknown[] = [];
  return {
    dispatch: async (_tool, args) => {
      seen.push(args);
      return payload;
    },
    seen,
  };
};

/** An oversized full payload: two FRAME sections of fat leaves (the fat mimics styling data). */
const oversizedFull = (): GetDesignContextResult => {
  const fat = 'x'.repeat(2000);
  const sections = ['a', 'b'].map((s, i) =>
    leaf(`s${i}`, {
      name: `Section ${s}`,
      type: i === 1 ? 'INSTANCE' : 'FRAME',
      // The second section is an instance: identity (mainComponentId) must survive the compact
      // downgrade while the full-only resolved mainComponent object must not.
      ...(i === 1 ? { mainComponentId: 'c:9', mainComponent: { id: 'c:9', name: 'Card' } } : {}),
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      children: Array.from({ length: 40 }, (_c, l) =>
        leaf(`s${i}-l${l}`, { fills: fat, x: 1, y: 2, width: 3, height: 4 }),
      ),
    }),
  );
  return {
    nodes: [leaf('root', { name: 'Page', type: 'FRAME', children: sections })],
    globalVars: { styles: { deadbeef: { fills: fat } } },
  };
};

describe('handleDesignContext (the public-path guard)', () => {
  it('defaults to the codegen view: injects detail full + dedupeComponents true + budget', async () => {
    const { dispatch, seen } = dispatcher({ nodes: [leaf('1:1')] });
    await handleDesignContext(dispatch, {});
    expect(seen[0]).toMatchObject({ detail: 'full', dedupeComponents: true, budget: true });
  });

  it('respects an explicit detail/dedupe choice and strips a caller-supplied budget', async () => {
    const { dispatch, seen } = dispatcher({ nodes: [leaf('1:1')] });
    await handleDesignContext(dispatch, {
      detail: 'compact',
      dedupeComponents: false,
      budget: false,
    });
    expect(seen[0]).toMatchObject({ detail: 'compact', dedupeComponents: false, budget: true });
  });

  it('attaches the below-full note only on an explicit below-full detail', async () => {
    const { dispatch } = dispatcher({ nodes: [leaf('1:1')] });
    const compact = await handleDesignContext(dispatch, { detail: 'compact' });
    expect(compact.note).toMatch(/detail: "full"/);

    const defaulted = await handleDesignContext(dispatch, {});
    expect(defaulted.note).toBeUndefined();
    expect(defaulted.sectionPlan).toBeUndefined();
  });

  it('passes a small (defaulted-full) result through untouched', async () => {
    const { dispatch } = dispatcher({ nodes: [leaf('1:1')] });
    const r = await handleDesignContext(dispatch, {});
    expect(r.nodes[0]?.id).toBe('1:1');
    expect(r.note).toBeUndefined();
  });

  it('passes a plugin-side section plan through without re-processing', async () => {
    const bail: GetDesignContextResult = {
      nodes: [leaf('1:1')],
      sectionPlan: { reason: 'node-count', totalNodes: 2000, sections: [] },
      note: 'from plugin',
    };
    const { dispatch } = dispatcher(bail);
    const r = await handleDesignContext(dispatch, {});
    expect(r).toEqual(bail);
  });

  it('downgrades an oversized full payload, dropping styling and keeping the tree', async () => {
    const payload = oversizedFull();
    expect(JSON.stringify(payload).length).toBeGreaterThan(DESIGN_CONTEXT_CHAR_BUDGET);

    const { dispatch } = dispatcher(payload);
    const r = await handleDesignContext(dispatch, {});

    // Structure-only: geometry survives, styling and globalVars are gone, the tree shape is intact.
    expect(r.sectionPlan).toBeUndefined();
    expect(r.globalVars).toBeUndefined();
    expect(r.nodes[0]?.children).toHaveLength(2);
    // Instance→component identity survives the downgrade (plugin compact carries it too);
    // the full-only resolved mainComponent object does not.
    expect(r.nodes[0]?.children?.[1]?.mainComponentId).toBe('c:9');
    expect(r.nodes[0]?.children?.[1]?.mainComponent).toBeUndefined();
    const firstLeaf = r.nodes[0]?.children?.[0]?.children?.[0];
    expect(firstLeaf).toEqual({
      id: 's0-l0',
      name: 'n-s0-l0',
      type: 'RECTANGLE',
      x: 1,
      y: 2,
      width: 3,
      height: 4,
    });
    expect(JSON.stringify(r).length).toBeLessThanOrEqual(DESIGN_CONTEXT_CHAR_BUDGET);
    // This fixture carries no layout fields, so the layout tier fires first and yields the same
    // node shape as the compact rung; either way the note must say so and warn off x/y spacing.
    expect(r.note).toMatch(/APPEARANCE dropped/);
    expect(r.note).toMatch(/never from x\/y/);
  });

  it('keeps the breakpoint hint on a compact downgrade', async () => {
    const payload = { ...oversizedFull(), hint: 'breakpoints: ground each frame' };
    const { dispatch } = dispatcher(payload);
    const r = await handleDesignContext(dispatch, {});
    expect(r.hint).toBe('breakpoints: ground each frame');
  });

  it('falls through to a section plan when even the compact structure is over budget', async () => {
    // Two sections × 1200 leaves with long names: the compact projection alone tops 100k chars.
    const longName = 'section-content-'.repeat(6);
    const sections = ['a', 'b'].map((s, i) =>
      leaf(`s${i}`, {
        name: `Section ${s}`,
        type: 'FRAME',
        children: Array.from({ length: 1200 }, (_c, l) =>
          leaf(`s${i}-l${l}`, { name: `${longName}${l}`, x: 1, y: 2, width: 3, height: 4 }),
        ),
      }),
    );
    const payload: GetDesignContextResult = {
      nodes: [leaf('root', { name: 'Page', type: 'FRAME', children: sections })],
    };
    const { dispatch } = dispatcher(payload);
    const r = await handleDesignContext(dispatch, {});

    expect(r.sectionPlan?.reason).toBe('payload-size');
    expect(r.sectionPlan?.sections).toHaveLength(2);
    expect(r.sectionPlan?.sections[0]).toMatchObject({ nodeId: 's0', nodes: 1201 });
    expect(r.nodes).toEqual([{ id: 'root', name: 'Page', type: 'FRAME' }]);
  });

  it('turns an oversized explicit-compact payload into a section plan (no downgrade step)', async () => {
    // A compact tree can blow the client cap too (a giant page at ~80 chars/node); there is no
    // cheaper detail to degrade to, so the net goes straight to the plan.
    const sections = ['a', 'b'].map((s, i) =>
      leaf(`s${i}`, {
        name: `Section ${s}`,
        type: 'FRAME',
        children: Array.from({ length: 900 }, (_c, l) =>
          leaf(`s${i}-l${l}`, { name: 'x'.repeat(60), x: 1, y: 2, width: 3, height: 4 }),
        ),
      }),
    );
    const payload: GetDesignContextResult = {
      nodes: [leaf('root', { name: 'Page', type: 'FRAME', children: sections })],
    };
    const { dispatch } = dispatcher(payload);
    const r = await handleDesignContext(dispatch, { detail: 'compact' });

    expect(r.sectionPlan?.reason).toBe('payload-size');
    expect(r.nodes).toEqual([{ id: 'root', name: 'Page', type: 'FRAME' }]);
  });

  it('keeps an oversized explicit-compact payload that has nothing to split into', async () => {
    // One root, one child: a plan would strand the caller, and compact can't degrade further.
    const payload: GetDesignContextResult = {
      nodes: [leaf('root', { children: [leaf('only', { name: 'y'.repeat(120_000) })] })],
    };
    const { dispatch } = dispatcher(payload);
    const r = await handleDesignContext(dispatch, { detail: 'compact' });
    expect(r.sectionPlan).toBeUndefined();
    expect(r.nodes[0]?.children?.[0]?.id).toBe('only');
  });

  it('rescues an unsplittable oversized full payload via a downgrade', async () => {
    // The fat is styling (unknown fields) — the compact projection strips it, so the downgrade
    // fits even though there are no sections to plan.
    const payload: GetDesignContextResult = {
      nodes: [leaf('root', { children: [leaf('only', { fills: 'x'.repeat(120_000) })] })],
    };
    const { dispatch } = dispatcher(payload);
    const r = await handleDesignContext(dispatch, {});
    expect(r.sectionPlan).toBeUndefined();
    expect(r.nodes[0]?.children?.[0]).toEqual({ id: 'only', name: 'n-only', type: 'RECTANGLE' });
    expect(r.note).toMatch(/APPEARANCE dropped/);
  });
});

describe('handleDesignContext — value-reverse annotation', () => {
  const indexOf = (tokens: { name: string; value: string }[]) =>
    new Map(
      tokens.map(t => [
        t.value.toUpperCase(),
        [{ name: t.name, value: t.value, cssVar: `var(--${t.name})` }],
      ]),
    );

  it('annotates raw colors on a full result via the injected index loader', async () => {
    const { dispatch } = dispatcher({
      nodes: [leaf('1:1')],
      globalVars: { styles: { s: { color: '#6266F0' } } },
    });
    const r = await handleDesignContext(dispatch, {}, async () => ({
      index: indexOf([{ name: 'color-primary', value: '#6266F0' }]),
      utilityFirst: false,
    }));
    expect(r.projectTokens).toEqual({
      '#6266F0': { ref: 'var(--color-primary)', name: 'color-primary', matchedBy: ['value'] },
    });
  });

  it('never annotates below full detail', async () => {
    const { dispatch } = dispatcher({
      nodes: [leaf('1:1')],
      globalVars: { styles: { s: { color: '#6266F0' } } },
    });
    let loaderCalls = 0;
    const r = await handleDesignContext(dispatch, { detail: 'compact' }, async () => {
      loaderCalls += 1;
      return { index: indexOf([{ name: 'color-primary', value: '#6266F0' }]), utilityFirst: false };
    });
    expect(loaderCalls).toBe(0);
    expect(r.projectTokens).toBeUndefined();
  });

  it('drops projectTokens with the styling on a downgrade', async () => {
    const { dispatch } = dispatcher(oversizedFull());
    const r = await handleDesignContext(dispatch, {}, async () => ({
      index: indexOf([{ name: 'color-primary', value: '#6266F0' }]),
      utilityFirst: false,
    }));
    // Over budget → structure-only view; the annotation must not survive on a payload whose
    // colors are gone.
    expect(r.note).toMatch(/APPEARANCE dropped/);
    expect(r.projectTokens).toBeUndefined();
  });
});

describe('sectionPlanFromPayload', () => {
  it('descends through single-child wrappers (two hops max) to find sections', () => {
    const sections = [leaf('a', { children: [leaf('a1')] }), leaf('b')];
    const wrapper = leaf('wrap', { children: sections });
    const root = leaf('root', { children: [wrapper] });
    const plan = sectionPlanFromPayload({ nodes: [root] }, 123_456);
    expect(plan?.sectionPlan?.sections.map(s => s.nodeId)).toEqual(['a', 'b']);
    expect(plan?.sectionPlan?.payloadChars).toBe(123_456);
  });

  it('returns null when fewer than two sections exist', () => {
    expect(sectionPlanFromPayload({ nodes: [leaf('root')] }, 1)).toBeNull();
  });

  it('caps very wide plans and reports the omission', () => {
    const wide = Array.from({ length: 70 }, (_w, i) => leaf(`w${i}`));
    const plan = sectionPlanFromPayload({ nodes: [leaf('root', { children: wide })] }, 1);
    expect(plan?.sectionPlan?.sections).toHaveLength(60);
    expect(plan?.sectionPlan?.sectionsOmitted).toBe(10);
  });
});

describe('the LAYOUT downgrade tier', () => {
  /**
   * A full payload whose bulk is appearance: every leaf carries a fat styling field plus the layout
   * fields the tier must preserve. Sized so `full` blows the budget but the layout projection
   * fits.
   */
  const oversizedWithLayout = (leaves: number, fatChars: number): GetDesignContextResult => {
    const fat = 'x'.repeat(fatChars);
    const sections = ['a', 'b'].map((s, i) =>
      leaf(`s${i}`, {
        name: `Section ${s}`,
        type: 'FRAME',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        layout: {
          mode: 'VERTICAL',
          paddingTop: 16,
          paddingRight: 16,
          paddingBottom: 16,
          paddingLeft: 16,
          itemSpacing: 24,
          primaryAxisAlignItems: 'MIN',
          counterAxisAlignItems: 'CENTER',
        },
        children: Array.from({ length: leaves }, (_c, l) =>
          leaf(`s${i}-l${l}`, {
            x: 1,
            y: 2,
            width: 3,
            height: 4,
            // Preserved by the tier:
            layoutSizingHorizontal: 'FILL',
            layoutGrow: 1,
            constraints: { horizontal: 'STRETCH', vertical: 'MIN' },
            characters: `label ${l}`,
            componentProperties: { State: { type: 'VARIANT', value: 'default' } },
            // Dropped by the tier (appearance):
            fills: fat,
            effects: fat,
            boundVariables: { itemSpacing: ['VariableID:1:1'] },
          }),
        ),
      }),
    );
    return {
      nodes: [leaf('root', { name: 'Page', type: 'FRAME', children: sections })],
      globalVars: { styles: { deadbeef: { fills: fat } } },
    };
  };

  it('keeps the whole layout system when full is over budget but the layout tier fits', async () => {
    const payload = oversizedWithLayout(40, 2000);
    expect(JSON.stringify(payload).length).toBeGreaterThan(DESIGN_CONTEXT_CHAR_BUDGET);

    const { dispatch } = dispatcher(payload);
    const r = await handleDesignContext(dispatch, {});

    expect(r.sectionPlan).toBeUndefined();
    expect(JSON.stringify(r).length).toBeLessThanOrEqual(DESIGN_CONTEXT_CHAR_BUDGET);

    // The container's own layout survives — the whole point of the tier.
    const section = r.nodes[0]?.children?.[0];
    expect(section?.layout).toEqual(payload.nodes[0]?.children?.[0]?.layout);

    // A child keeps how it sizes/places itself and what it says…
    const child = section?.children?.[0];
    expect(child).toMatchObject({
      id: 's0-l0',
      x: 1,
      y: 2,
      width: 3,
      height: 4,
      layoutSizingHorizontal: 'FILL',
      layoutGrow: 1,
      constraints: { horizontal: 'STRETCH', vertical: 'MIN' },
      characters: 'label 0',
      componentProperties: { State: { type: 'VARIANT', value: 'default' } },
    });
    // …and loses only appearance.
    expect(child?.fills).toBeUndefined();
    expect(child?.effects).toBeUndefined();
    expect(child?.boundVariables).toBeUndefined();
    expect(r.globalVars).toBeUndefined();

    expect(r.note).toMatch(/LAYOUT intact/);
    expect(r.note).toMatch(/never from x\/y/);
  });

  it('falls through to geometry-only when even the layout tier is over budget', async () => {
    // Fat lives in `layout` itself, so the tier cannot shed enough and the next rung must fire.
    const bigLayout = { mode: 'VERTICAL', filler: 'x'.repeat(200) };
    const sections = ['a', 'b'].map((s, i) =>
      leaf(`s${i}`, {
        name: `Section ${s}`,
        type: 'FRAME',
        children: Array.from({ length: 400 }, (_c, l) =>
          leaf(`s${i}-l${l}`, { x: 1, y: 2, width: 3, height: 4, layout: bigLayout }),
        ),
      }),
    );
    const payload: GetDesignContextResult = {
      nodes: [leaf('root', { name: 'Page', type: 'FRAME', children: sections })],
    };
    const { dispatch } = dispatcher(payload);
    const r = await handleDesignContext(dispatch, {});

    expect(r.sectionPlan).toBeUndefined();
    expect(r.nodes[0]?.children?.[0]?.children?.[0]).toEqual({
      id: 's0-l0',
      name: 'n-s0-l0',
      type: 'RECTANGLE',
      x: 1,
      y: 2,
      width: 3,
      height: 4,
    });
    expect(r.note).toMatch(/too large even with layout alone/);
  });

  it('keeps the breakpoint hint on a layout downgrade', async () => {
    const payload = { ...oversizedWithLayout(40, 2000), hint: 'breakpoints: ground each frame' };
    const { dispatch } = dispatcher(payload);
    const r = await handleDesignContext(dispatch, {});
    expect(r.hint).toBe('breakpoints: ground each frame');
  });
});

describe('every degraded shape leads with its note', () => {
  // The consumer reads the payload top to bottom; a caveat serialized after the nodes is read after
  // every coordinate it warns about. Assert on key ORDER, which JSON.stringify preserves.
  const firstKey = (r: GetDesignContextResult): string => Object.keys(r)[0] as string;

  it('leads with the note on a layout downgrade', async () => {
    const payload = (() => {
      const fat = 'x'.repeat(2000);
      return {
        nodes: [
          leaf('root', {
            name: 'Page',
            type: 'FRAME',
            children: Array.from({ length: 60 }, (_c, l) =>
              leaf(`l${l}`, {
                x: 1,
                y: 2,
                width: 3,
                height: 4,
                layout: { mode: 'VERTICAL' },
                fills: fat,
              }),
            ),
          }),
        ],
      } satisfies GetDesignContextResult;
    })();
    const { dispatch } = dispatcher(payload);
    const r = await handleDesignContext(dispatch, {});
    expect(firstKey(r)).toBe('note');
  });

  it('leads with the note on a compact downgrade', async () => {
    const { dispatch } = dispatcher(oversizedFull());
    const r = await handleDesignContext(dispatch, {});
    expect(firstKey(r)).toBe('note');
  });

  it('leads with the note on a section plan', () => {
    const plan = sectionPlanFromPayload(
      { nodes: [leaf('root', { children: [leaf('a'), leaf('b')] })] },
      200_000,
    );
    expect(plan).not.toBeNull();
    expect(firstKey(plan as GetDesignContextResult)).toBe('note');
  });

  it('leads with the note on an explicit below-full result', async () => {
    const { dispatch } = dispatcher({ nodes: [leaf('1:1')] });
    const r = await handleDesignContext(dispatch, { detail: 'compact' });
    expect(firstKey(r)).toBe('note');
  });
});

describe('the layout rung sheds content before it sheds layout', () => {
  it('drops text/props rather than collapsing to geometry when only just over budget', async () => {
    // Sized so layout+content misses the budget but layout alone clears it — the band where the
    // naive two-rung cascade would have traded the entire box model for some strings.
    const layout = {
      mode: 'VERTICAL',
      paddingTop: 16,
      paddingRight: 16,
      paddingBottom: 16,
      paddingLeft: 16,
      itemSpacing: 24,
    };
    const sections = ['a', 'b'].map((s, i) =>
      leaf(`s${i}`, {
        name: `Section ${s}`,
        type: 'FRAME',
        layout,
        children: Array.from({ length: 180 }, (_c, l) =>
          leaf(`s${i}-l${l}`, {
            x: 1,
            y: 2,
            width: 3,
            height: 4,
            layout,
            layoutSizingHorizontal: 'FILL',
            characters: 'y'.repeat(90),
            fills: 'x'.repeat(400),
          }),
        ),
      }),
    );
    const payload: GetDesignContextResult = {
      nodes: [leaf('root', { name: 'Page', type: 'FRAME', children: sections })],
    };
    const { dispatch } = dispatcher(payload);
    const r = await handleDesignContext(dispatch, {});

    const child = r.nodes[0]?.children?.[0]?.children?.[0];
    // Layout survived…
    expect(child?.layout).toEqual(layout);
    expect(child?.layoutSizingHorizontal).toBe('FILL');
    // …and it was the text, not the box model, that paid for the overage.
    expect(child?.characters).toBeUndefined();
    expect(child?.fills).toBeUndefined();
    expect(r.note).toMatch(/missing is text content/);
    expect(JSON.stringify(r).length).toBeLessThanOrEqual(DESIGN_CONTEXT_CHAR_BUDGET);
  });
});
