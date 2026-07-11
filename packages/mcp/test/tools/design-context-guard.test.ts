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

describe('handleDesignContext (the public-path guard)', () => {
  it('arms the plugin bail with budget: true and strips a caller-supplied budget', async () => {
    const { dispatch, seen } = dispatcher({ nodes: [leaf('1:1')] });
    await handleDesignContext(dispatch, { detail: 'full', budget: false });
    expect(seen[0]).toMatchObject({ detail: 'full', budget: true });
  });

  it('attaches the below-full note on the default (compact) detail', async () => {
    const { dispatch } = dispatcher({ nodes: [leaf('1:1')] });
    const r = await handleDesignContext(dispatch, {});
    expect(r.note).toMatch(/detail: "full"/);
    expect(r.sectionPlan).toBeUndefined();
  });

  it('passes a small full result through untouched (no note)', async () => {
    const { dispatch } = dispatcher({ nodes: [leaf('1:1')] });
    const r = await handleDesignContext(dispatch, { detail: 'full' });
    expect(r.note).toBeUndefined();
    expect(r.nodes[0]?.id).toBe('1:1');
  });

  it('passes a plugin-side section plan through without re-processing', async () => {
    const bail: GetDesignContextResult = {
      nodes: [leaf('1:1')],
      sectionPlan: { reason: 'node-count', totalNodes: 2000, sections: [] },
      note: 'from plugin',
    };
    const { dispatch } = dispatcher(bail);
    const r = await handleDesignContext(dispatch, { detail: 'full' });
    expect(r).toEqual(bail);
  });

  it('replaces an oversized full payload with a payload-size section plan', async () => {
    // Two sections of fat leaves: the stringified payload must exceed the char budget.
    const fat = 'x'.repeat(2000);
    const sections = ['a', 'b'].map((s, i) =>
      leaf(`s${i}`, {
        name: `Section ${s}`,
        type: 'FRAME',
        children: Array.from({ length: 40 }, (_, l) => leaf(`s${i}-l${l}`, { fatField: fat })),
      }),
    );
    const payload: GetDesignContextResult = {
      nodes: [leaf('root', { name: 'Page', type: 'FRAME', children: sections })],
    };
    expect(JSON.stringify(payload).length).toBeGreaterThan(DESIGN_CONTEXT_CHAR_BUDGET);

    const { dispatch } = dispatcher(payload);
    const r = await handleDesignContext(dispatch, { detail: 'full' });

    expect(r.sectionPlan?.reason).toBe('payload-size');
    expect(r.sectionPlan?.payloadChars).toBe(JSON.stringify(payload).length);
    expect(r.sectionPlan?.sections).toHaveLength(2);
    expect(r.sectionPlan?.sections[0]).toMatchObject({ nodeId: 's0', childCount: 40, nodes: 41 });
    // Roots keep identity only; the oversized data does not ride along.
    expect(r.nodes).toEqual([{ id: 'root', name: 'Page', type: 'FRAME' }]);
    expect(JSON.stringify(r).length).toBeLessThan(DESIGN_CONTEXT_CHAR_BUDGET);
    expect(r.note).toMatch(/section by section/);
  });

  it('keeps an oversized payload that has nothing to split into', async () => {
    // One root, one child, no grandchildren: a plan would strand the caller with no way forward.
    const payload: GetDesignContextResult = {
      nodes: [leaf('root', { children: [leaf('only', { fatField: 'x'.repeat(120_000) })] })],
    };
    const { dispatch } = dispatcher(payload);
    const r = await handleDesignContext(dispatch, { detail: 'full' });
    expect(r.sectionPlan).toBeUndefined();
    expect(r.nodes[0]?.children?.[0]?.id).toBe('only');
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
    const wide = Array.from({ length: 70 }, (_, i) => leaf(`w${i}`));
    const plan = sectionPlanFromPayload({ nodes: [leaf('root', { children: wide })] }, 1);
    expect(plan?.sectionPlan?.sections).toHaveLength(60);
    expect(plan?.sectionPlan?.sectionsOmitted).toBe(10);
  });
});
