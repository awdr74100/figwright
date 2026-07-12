import type { MutateResult } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import { createSetAutoLayoutHandler } from '../../src/handlers/set-auto-layout.js';

const fakeFigma = (lookup: Record<string, unknown>): typeof figma =>
  ({ getNodeByIdAsync: async (id: string) => lookup[id] ?? null }) as unknown as typeof figma;

const makeFrame = () => ({
  id: '1:1',
  layoutMode: 'NONE',
  paddingTop: 0,
  paddingRight: 0,
  paddingBottom: 0,
  paddingLeft: 0,
  itemSpacing: 0,
  primaryAxisAlignItems: 'MIN',
  counterAxisAlignItems: 'MIN',
  layoutWrap: 'NO_WRAP',
  counterAxisSpacing: null as number | null,
  counterAxisAlignContent: 'AUTO',
  itemReverseZIndex: false,
  strokesIncludedInLayout: false,
  gridRowCount: 0,
  gridColumnCount: 0,
  gridRowGap: 0,
  gridColumnGap: 0,
});

describe('set_auto_layout handler', () => {
  it('enables auto layout and applies padding / spacing / alignment', async () => {
    const node = makeFrame();
    const handler = createSetAutoLayoutHandler(fakeFigma({ '1:1': node }));
    const result = (await handler({
      nodeId: '1:1',
      layoutMode: 'HORIZONTAL',
      paddingTop: 8,
      itemSpacing: 4,
      primaryAxisAlignItems: 'CENTER',
    })) as MutateResult;

    expect(node.layoutMode).toBe('HORIZONTAL');
    expect(node.paddingTop).toBe(8);
    expect(node.itemSpacing).toBe(4);
    expect(node.primaryAxisAlignItems).toBe('CENTER');
    expect(result).toEqual({ ok: true, nodeId: '1:1' });
  });

  it('ignores layout sub-props when mode is NONE', async () => {
    const node = makeFrame();
    node.layoutMode = 'HORIZONTAL';
    const handler = createSetAutoLayoutHandler(fakeFigma({ '1:1': node }));
    await handler({ nodeId: '1:1', layoutMode: 'NONE', paddingTop: 99 });
    expect(node.layoutMode).toBe('NONE');
    expect(node.paddingTop).toBe(0);
  });

  it('enables GRID layout with counts / gaps, skips H/V-only flex props', async () => {
    const node = makeFrame();
    const handler = createSetAutoLayoutHandler(fakeFigma({ '1:1': node }));
    const result = (await handler({
      nodeId: '1:1',
      layoutMode: 'GRID',
      paddingTop: 16,
      gridRowCount: 2,
      gridColumnCount: 3,
      gridRowGap: 8,
      gridColumnGap: 12,
      itemSpacing: 99, // H/V-only — must be ignored in GRID mode
    })) as MutateResult;

    expect(node.layoutMode).toBe('GRID');
    expect(node.paddingTop).toBe(16);
    expect(node.gridRowCount).toBe(2);
    expect(node.gridColumnCount).toBe(3);
    expect(node.gridRowGap).toBe(8);
    expect(node.gridColumnGap).toBe(12);
    expect(node.itemSpacing).toBe(0); // unchanged — itemSpacing is flex-only
    expect(result).toEqual({ ok: true, nodeId: '1:1' });
  });

  it('sets the wrap cross-axis (row gap + align-content) when enabling WRAP in the same call', async () => {
    const node = makeFrame();
    const handler = createSetAutoLayoutHandler(fakeFigma({ '1:1': node }));
    await handler({
      nodeId: '1:1',
      layoutMode: 'HORIZONTAL',
      itemSpacing: 8,
      layoutWrap: 'WRAP',
      counterAxisSpacing: 16,
      counterAxisAlignContent: 'SPACE_BETWEEN',
    });
    expect(node.layoutWrap).toBe('WRAP');
    expect(node.counterAxisSpacing).toBe(16);
    expect(node.counterAxisAlignContent).toBe('SPACE_BETWEEN');
  });

  it('sets the row gap on an already-wrapping frame without re-passing layoutWrap', async () => {
    const node = makeFrame();
    node.layoutWrap = 'WRAP';
    const handler = createSetAutoLayoutHandler(fakeFigma({ '1:1': node }));
    await handler({ nodeId: '1:1', layoutMode: 'HORIZONTAL', counterAxisSpacing: 24 });
    expect(node.counterAxisSpacing).toBe(24);
  });

  it('rejects cross-axis fields on a non-wrapping flex instead of a silent no-op', async () => {
    const handler = createSetAutoLayoutHandler(fakeFigma({ '1:1': makeFrame() }));
    await expect(
      handler({ nodeId: '1:1', layoutMode: 'HORIZONTAL', counterAxisSpacing: 16 }),
    ).rejects.toThrow(/apply only to a wrapping flex/);
    await expect(
      handler({ nodeId: '1:1', layoutMode: 'VERTICAL', counterAxisAlignContent: 'SPACE_BETWEEN' }),
    ).rejects.toThrow(/layoutWrap/);
  });

  it('rejects the contradiction before mutating anything (no partial change left behind)', async () => {
    // NO_WRAP + counterAxisSpacing is contradictory input. Caught live: the first cut applied
    // layoutWrap (and layoutMode/itemSpacing) before throwing, leaving a partial change.
    const node = makeFrame();
    node.layoutMode = 'HORIZONTAL';
    node.layoutWrap = 'WRAP';
    node.itemSpacing = 8;
    const handler = createSetAutoLayoutHandler(fakeFigma({ '1:1': node }));
    await expect(
      handler({
        nodeId: '1:1',
        layoutMode: 'HORIZONTAL',
        itemSpacing: 99,
        layoutWrap: 'NO_WRAP',
        counterAxisSpacing: 20,
      }),
    ).rejects.toThrow(/apply only to a wrapping flex/);
    // Every field untouched — the reject happened before the first mutation.
    expect(node).toMatchObject({ layoutMode: 'HORIZONTAL', layoutWrap: 'WRAP', itemSpacing: 8 });
  });

  it('throws on bad layoutMode or a node without auto layout', async () => {
    const handler = createSetAutoLayoutHandler(fakeFigma({ '1:1': makeFrame() }));
    await expect(handler({ nodeId: '1:1', layoutMode: 'DIAGONAL' })).rejects.toThrow(/layoutMode/);
    await expect(handler({ nodeId: '9:9', layoutMode: 'VERTICAL' })).rejects.toThrow(/not found/);
  });

  it('sets reversed paint order and stroke-in-layout on a flex frame', async () => {
    const node = makeFrame();
    const handler = createSetAutoLayoutHandler(fakeFigma({ '1:1': node }));
    await handler({
      nodeId: '1:1',
      layoutMode: 'HORIZONTAL',
      itemSpacing: -8,
      itemReverseZIndex: true,
      strokesIncludedInLayout: true,
    });
    expect(node.itemReverseZIndex).toBe(true);
    expect(node.strokesIncludedInLayout).toBe(true);
    expect(node.itemSpacing).toBe(-8);
  });
});
