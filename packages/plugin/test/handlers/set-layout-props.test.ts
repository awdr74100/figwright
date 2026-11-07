import type { LayoutPropsResult, MutateResult } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import { createSetLayoutPropsHandler } from '../../src/handlers/set-layout-props.js';

const fakeFigma = (lookup: Record<string, unknown>): typeof figma =>
  ({ getNodeByIdAsync: async (id: string) => lookup[id] ?? null }) as unknown as typeof figma;

describe('set_layout_props handler', () => {
  it('sets layoutAlign / layoutGrow / layoutPositioning', async () => {
    const node = { id: '1:1', layoutAlign: 'INHERIT', layoutGrow: 0, layoutPositioning: 'AUTO' };
    const result = (await createSetLayoutPropsHandler(fakeFigma({ '1:1': node }))({
      nodeId: '1:1',
      layoutAlign: 'STRETCH',
      layoutGrow: 1,
      layoutPositioning: 'ABSOLUTE',
    })) as MutateResult;

    expect(node).toMatchObject({
      layoutAlign: 'STRETCH',
      layoutGrow: 1,
      layoutPositioning: 'ABSOLUTE',
    });
    expect(result).toEqual({ ok: true, nodeId: '1:1' });
  });

  it.each(['MIN', 'CENTER', 'MAX'])(
    'refuses the deprecated layoutAlign %s, which Figma resets and would report as done',
    async value => {
      const node = { id: '1:1', layoutAlign: 'INHERIT', layoutGrow: 0, layoutPositioning: 'AUTO' };
      await expect(
        createSetLayoutPropsHandler(fakeFigma({ '1:1': node }))({
          nodeId: '1:1',
          layoutAlign: value,
        }),
      ).rejects.toThrow(/no longer does anything.*align_nodes/s);
      expect(node.layoutAlign).toBe('INHERIT');
    },
  );

  it('leaves omitted fields untouched (partial update)', async () => {
    const node = { id: '1:1', layoutAlign: 'STRETCH', layoutGrow: 1, layoutPositioning: 'AUTO' };
    await createSetLayoutPropsHandler(fakeFigma({ '1:1': node }))({
      nodeId: '1:1',
      layoutGrow: 0,
    });
    expect(node).toMatchObject({
      layoutAlign: 'STRETCH',
      layoutGrow: 0,
      layoutPositioning: 'AUTO',
    });
  });

  it('throws on missing node, a node without layout child props, or bad input', async () => {
    await expect(createSetLayoutPropsHandler(fakeFigma({}))({ nodeId: '9:9' })).rejects.toThrow(
      /not found/,
    );
    await expect(
      createSetLayoutPropsHandler(fakeFigma({ '1:1': { id: '1:1' } }))({ nodeId: '1:1' }),
    ).rejects.toThrow(/no auto-layout child properties/);
    await expect(
      createSetLayoutPropsHandler(fakeFigma({ '1:1': { id: '1:1', layoutAlign: 'INHERIT' } }))({
        nodeId: '1:1',
        layoutGrow: -1,
      }),
    ).rejects.toThrow(/layoutGrow/);
    await expect(createSetLayoutPropsHandler(fakeFigma({}))({})).rejects.toThrow(/nodeId/);
  });

  it('sets layoutSizingHorizontal / layoutSizingVertical', async () => {
    const node = {
      id: '1:1',
      layoutAlign: 'INHERIT',
      layoutSizingHorizontal: 'FIXED',
      layoutSizingVertical: 'FIXED',
    };
    await createSetLayoutPropsHandler(fakeFigma({ '1:1': node }))({
      nodeId: '1:1',
      layoutSizingHorizontal: 'HUG',
      layoutSizingVertical: 'FILL',
    });
    expect(node).toMatchObject({ layoutSizingHorizontal: 'HUG', layoutSizingVertical: 'FILL' });
  });

  it('throws when the node lacks the sizing property', async () => {
    await expect(
      createSetLayoutPropsHandler(fakeFigma({ '1:1': { id: '1:1', layoutAlign: 'INHERIT' } }))({
        nodeId: '1:1',
        layoutSizingVertical: 'HUG',
      }),
    ).rejects.toThrow(/does not support/);
  });

  it('sets and clears min/max size bounds', async () => {
    const node = {
      id: '1:1',
      layoutAlign: 'INHERIT',
      minWidth: null,
      maxWidth: 800,
      minHeight: null,
      maxHeight: null,
    };
    await createSetLayoutPropsHandler(fakeFigma({ '1:1': node }))({
      nodeId: '1:1',
      minWidth: 120,
      maxWidth: null, // clears the existing bound
      maxHeight: 300,
    });
    expect(node).toMatchObject({ minWidth: 120, maxWidth: null, minHeight: null, maxHeight: 300 });
  });

  it('rejects a non-positive bound and a node without bounds', async () => {
    await expect(
      createSetLayoutPropsHandler(fakeFigma({ '1:1': { id: '1:1', layoutAlign: 'INHERIT' } }))({
        nodeId: '1:1',
        minWidth: 0,
      }),
    ).rejects.toThrow(/minWidth must be a positive number or null/);
    await expect(
      createSetLayoutPropsHandler(fakeFigma({ '1:1': { id: '1:1', layoutAlign: 'INHERIT' } }))({
        nodeId: '1:1',
        maxHeight: 100,
      }),
    ).rejects.toThrow(/does not support maxHeight/);
  });

  it('surfaces an actionable error when Figma rejects a bound', async () => {
    const node = {
      id: '1:1',
      layoutAlign: 'INHERIT',
      set minWidth(_v: number | null) {
        throw new Error('node must be an auto layout frame or child');
      },
    };
    await expect(
      createSetLayoutPropsHandler(fakeFigma({ '1:1': node }))({ nodeId: '1:1', minWidth: 50 }),
    ).rejects.toThrow(/bounds apply to auto-layout frames/);
  });

  it('surfaces an actionable error when Figma rejects a sizing value', async () => {
    const node = {
      id: '1:1',
      layoutAlign: 'INHERIT',
      set layoutSizingHorizontal(_v: string) {
        throw new Error('not an auto layout frame');
      },
    };
    await expect(
      createSetLayoutPropsHandler(fakeFigma({ '1:1': node }))({
        nodeId: '1:1',
        layoutSizingHorizontal: 'HUG',
      }),
    ).rejects.toThrow(/HUG needs an auto-layout frame/);
  });

  // Measured: Figma keeps one truncation limit on a text — setting maxHeight clears maxLines — and a
  // FIXED / FILL height makes it a fixed box, which shows no line count. The write lands as asked;
  // the line count it cost is named instead of answering a bare ok.
  describe('on a text clamped to a line count', () => {
    const clampedText = () => {
      const state = {
        maxLines: 2 as number | null,
        maxHeight: null as number | null,
        textAutoResize: 'HEIGHT',
        layoutSizingVertical: 'HUG',
      };
      const text = {
        id: '1:5',
        type: 'TEXT',
        layoutAlign: 'INHERIT',
        layoutGrow: 0,
        layoutPositioning: 'AUTO',
        layoutSizingHorizontal: 'FIXED',
        minWidth: null,
        maxWidth: null,
        minHeight: null,
        get maxLines() {
          return state.maxLines;
        },
        get maxHeight() {
          return state.maxHeight;
        },
        set maxHeight(v: number | null) {
          state.maxHeight = v;
          if (v !== null) state.maxLines = null;
        },
        get textAutoResize() {
          return state.textAutoResize;
        },
        get layoutSizingVertical() {
          return state.layoutSizingVertical;
        },
        set layoutSizingVertical(v: string) {
          state.layoutSizingVertical = v;
          if (v !== 'HUG') {
            state.textAutoResize = 'TRUNCATE';
            state.maxLines = null;
          }
        },
      };
      return text;
    };
    const run = async (args: Record<string, unknown>) => {
      const text = clampedText();
      const result = (await createSetLayoutPropsHandler(fakeFigma({ '1:5': text }))({
        nodeId: '1:5',
        ...args,
      })) as LayoutPropsResult;
      return { text, result };
    };

    it('sets maxHeight and names the line count it replaced', async () => {
      const { text, result } = await run({ maxHeight: 40 });
      expect(text.maxHeight).toBe(40);
      expect(result.adjusted).toBe(
        'maxLines 2 was cleared — a text truncates at one limit, a line count or a maxHeight, and ' +
          'maxHeight 40 replaced it',
      );
    });

    it.each(['FIXED', 'FILL'])(
      'sets a %s height and names the line count a fixed box does not show',
      async value => {
        const { text, result } = await run({ layoutSizingVertical: value });
        expect(text.layoutSizingVertical).toBe(value);
        expect(result.adjusted).toMatch(/^maxLines 2 was cleared — the box is now a fixed height/);
      },
    );

    it.each([
      { minHeight: 20 },
      { maxWidth: 200 },
      { layoutSizingVertical: 'HUG' },
      { maxHeight: null },
    ])('reports nothing when %o leaves the line count', async args => {
      const { text, result } = await run(args);
      expect(text.maxLines).toBe(2);
      expect(result).toEqual({ ok: true, nodeId: '1:5' });
    });
  });
});
