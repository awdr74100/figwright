import { evaluateResponsiveRoot, resolveResponsiveLayoutConfig } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import {
  applyPreparedResponsiveRoot,
  prepareResponsiveRoot,
  validateResponsiveOwnership,
} from '../src/responsive-layout-adapter.js';
import { createResponsiveFixture } from './responsive-layout-fixtures.js';

const resolve = (f: ReturnType<typeof createResponsiveFixture>) =>
  resolveResponsiveLayoutConfig(f.config);
const run = async (f: ReturnType<typeof createResponsiveFixture>, width = 900) => {
  const root = resolve(f).roots[0]!;
  const prepared = await prepareResponsiveRoot(f.api, root, 'p');
  return applyPreparedResponsiveRoot(prepared, evaluateResponsiveRoot(root, width), () => true);
};

describe('protected responsive adapter', () => {
  it('grid grows an owned HUG axis without transient FLEX conflicts', async () => {
    const f = createResponsiveFixture('grid');
    f.config.roots[0]!.base = [
      { type: 'layout', nodeId: 'f', values: { layoutSizingHorizontal: 'HUG' } },
      {
        type: 'grid',
        nodeId: 'f',
        values: { columns: [{ type: 'HUG' }, { type: 'HUG' }, { type: 'HUG' }] },
      },
    ];
    await run(f);
    f.writes.length = 0;
    f.config.roots[0]!.base[1] = {
      type: 'grid',
      nodeId: 'f',
      values: { columns: [{ type: 'HUG' }, { type: 'HUG' }, { type: 'HUG' }, { type: 'HUG' }] },
    };
    await run(f);
    expect(f.frame.gridColumnCount).toBe(4);
    expect(f.frame.layoutSizingHorizontal).toBe('HUG');
    expect(f.frame.gridColumnSizes.every((t: { type: string }) => t.type === 'HUG')).toBe(true);
  });
  it('grid refuses HUG growth when the sizing field is not owned', async () => {
    const f = createResponsiveFixture('grid');
    f.frame.gridColumnSizes = [
      f.makeTrack('f', 'HUG'),
      f.makeTrack('f', 'HUG'),
      f.makeTrack('f', 'HUG'),
    ];
    f.frame.layoutSizingHorizontal = 'HUG';
    f.writes.length = 0;
    f.config.roots[0]!.base = [
      {
        type: 'grid',
        nodeId: 'f',
        values: { columns: [{ type: 'HUG' }, { type: 'HUG' }, { type: 'HUG' }, { type: 'HUG' }] },
      },
    ];
    await expect(run(f)).rejects.toMatchObject({ phase: 'validate' });
    expect(f.writes).toEqual([]);
  });
  it.each([
    { owned: true, outcome: 'applied', rowCount: 2 },
    { owned: false, outcome: 'validate', rowCount: 1 },
  ])(
    'grid automatic HUG row growth respects sizing ownership $owned',
    async ({ owned, outcome, rowCount }) => {
      const f = createResponsiveFixture('grid');
      f.frame.gridAutoTracks = 'ROWS';
      f.frame.gridRowSizes = [f.makeTrack('f', 'HUG')];
      f.frame.layoutSizingVertical = 'HUG';
      f.config.roots[0]!.base = [
        ...(owned
          ? [
              {
                type: 'layout' as const,
                nodeId: 'f',
                values: { layoutSizingVertical: 'HUG' as const },
              },
            ]
          : []),
        {
          type: 'grid',
          nodeId: 'f',
          values: {
            gridItemsPositioning: 'ROW_AUTO_FLOW',
            gridAutoTracks: 'ROWS',
            autoRowTrack: { type: 'HUG' },
            columns: [
              { type: 'FIXED', value: 160 },
              { type: 'FIXED', value: 160 },
            ],
          },
        },
      ];
      f.writes.length = 0;
      const result = await run(f).then(
        applied => applied.status,
        error => error.phase,
      );
      expect(result).toBe(outcome);
      expect(f.writes.length > 0).toBe(owned);
      expect(f.frame.gridRowCount).toBe(rowCount);
      expect(f.frame.layoutSizingVertical).toBe('HUG');
      expect(f.frame.gridRowSizes.every((t: { type: string }) => t.type === 'HUG')).toBe(true);
      expect(f.writes.some(w => w.field === 'gridRowCount')).toBe(false);
    },
  );
  it('applies a numeric value before its binding so literals cannot silently clear it', async () => {
    const f = createResponsiveFixture();
    f.variables.set('v', {
      id: 'v',
      resolvedType: 'FLOAT',
      resolveForConsumer: () => ({ value: 8, resolvedType: 'FLOAT' }),
    });
    f.config.roots[0]!.base = [
      { type: 'layout', nodeId: 'f', values: { paddingTop: { value: 8, variableId: 'v' } } },
    ];
    await run(f);
    expect(f.frame.paddingTop).toBe(8);
    expect(f.frame.boundVariables.paddingTop?.id).toBe('v');
  });
  it('grid preserves unequal tracks and declared row strategy', async () => {
    const f = createResponsiveFixture('grid');
    f.config.roots[0]!.base = [
      {
        type: 'grid',
        nodeId: 'f',
        values: {
          columns: [
            { type: 'FLEX', value: 2 },
            { type: 'FIXED', value: 240 },
            { type: 'FLEX', value: 1 },
          ],
          rows: [{ type: 'FIXED', value: 80 }, { type: 'HUG' }],
          gridItemsPositioning: 'MANUAL',
          gridAutoTracks: 'NONE',
          gridColumnGap: { value: 16 },
        },
      },
    ];
    const ids = f.frame.children.map((n: { id: string }) => n.id);
    await run(f);
    expect(
      f.frame.gridColumnSizes.map((t: { type: string; value?: number }) => ({
        type: t.type,
        value: t.value,
      })),
    ).toEqual([
      { type: 'FLEX', value: 2 },
      { type: 'FIXED', value: 240 },
      { type: 'FLEX', value: 1 },
    ]);
    expect(f.frame.layoutSizingVertical).toBe('FIXED');
    expect(f.frame.children.map((n: { id: string }) => n.id)).toEqual(ids);
    const count = f.writes.length;
    await run(f);
    expect(f.writes).toHaveLength(count);
  });
  it('grid automatic rows never write row count and replenish new tracks', async () => {
    const f = createResponsiveFixture('grid');
    f.config.roots[0]!.base = [
      {
        type: 'grid',
        nodeId: 'f',
        values: {
          columns: [{ type: 'FLEX', value: 1 }],
          gridItemsPositioning: 'ROW_AUTO_FLOW',
          gridAutoTracks: 'ROWS',
          autoRowTrack: { type: 'FIXED', value: 96 },
        },
      },
    ];
    await run(f);
    expect(f.writes.some(w => w.field === 'gridRowCount')).toBe(false);
    expect(f.frame.gridRowSizes).toHaveLength(3);
    expect(
      f.frame.gridRowSizes.every(
        (t: { type: string; value: number }) => t.type === 'FIXED' && t.value === 96,
      ),
    ).toBe(true);
  });
  it('grid gap-only preserves complex manual placement and unowned tracks', async () => {
    const f = createResponsiveFixture('grid');
    f.frame.children[0].gridColumnSpan = 2;
    f.writes.length = 0;
    f.config.roots[0]!.base = [
      { type: 'grid', nodeId: 'f', values: { gridRowGap: { value: 12 } } },
    ];
    await run(f);
    expect(f.writes.map(w => w.field)).toEqual(['gridRowGap']);
  });
  it.each([
    'manual-shrink',
    'absolute',
    'span',
    'missing-track',
    'rows-and-auto',
    'hug-flex',
    'runtime',
  ])('grid rejects %s before writes', async scenario => {
    const f = createResponsiveFixture('grid');
    const values: Record<string, unknown> = { columns: [{ type: 'FLEX', value: 1 }] };
    if (scenario === 'absolute' || scenario === 'span') {
      values.gridItemsPositioning = 'ROW_AUTO_FLOW';
      f.frame.children[0][scenario === 'absolute' ? 'layoutPositioning' : 'gridColumnSpan'] =
        scenario === 'absolute' ? 'ABSOLUTE' : 2;
    }
    if (scenario === 'missing-track') values.gridAutoTracks = 'ROWS';
    if (scenario === 'rows-and-auto')
      Object.assign(values, {
        gridAutoTracks: 'ROWS',
        autoRowTrack: { type: 'HUG' },
        rows: [{ type: 'HUG' }],
      });
    if (scenario === 'hug-flex') {
      f.frame.gridColumnSizes = [
        f.makeTrack('f', 'HUG'),
        f.makeTrack('f', 'HUG'),
        f.makeTrack('f', 'HUG'),
      ];
      f.frame.layoutSizingHorizontal = 'HUG';
      values.columns = [
        { type: 'FLEX', value: 1 },
        { type: 'FLEX', value: 1 },
        { type: 'FLEX', value: 1 },
      ];
    }
    if (scenario === 'runtime') delete f.frame.gridColumnSizes;
    f.writes.length = 0;
    f.config.roots[0]!.base = [{ type: 'grid', nodeId: 'f', values } as never];
    await expect(run(f)).rejects.toMatchObject({ phase: 'validate' });
    expect(f.writes).toEqual([]);
  });
  it('grid rejects conflict at a future breakpoint before applying base', async () => {
    const f = createResponsiveFixture('grid');
    f.config.roots[0]!.base = [
      {
        type: 'grid',
        nodeId: 'f',
        values: { columns: [{ type: 'HUG' }, { type: 'HUG' }, { type: 'HUG' }] },
      },
      { type: 'layout', nodeId: 'f', values: { layoutSizingHorizontal: 'HUG' } },
    ];
    f.config.roots[0]!.breakpoints[2]!.overrides = [
      {
        type: 'grid',
        nodeId: 'f',
        values: {
          columns: [
            { type: 'FLEX', value: 1 },
            { type: 'FLEX', value: 1 },
            { type: 'FLEX', value: 1 },
          ],
        },
      },
    ];
    await expect(run(f)).rejects.toMatchObject({ phase: 'validate' });
    expect(f.writes).toEqual([]);
  });
  it('grid composes sizing with tracks before validating and writing', async () => {
    const f = createResponsiveFixture('grid');
    f.config.roots[0]!.base = [
      { type: 'layout', nodeId: 'f', values: { layoutSizingHorizontal: 'HUG' } },
      {
        type: 'grid',
        nodeId: 'f',
        values: { columns: [{ type: 'HUG' }, { type: 'HUG' }, { type: 'HUG' }] },
      },
    ];
    await run(f);
    expect(f.frame.layoutSizingHorizontal).toBe('HUG');
    f.config.roots[0]!.base = [
      {
        type: 'grid',
        nodeId: 'f',
        values: {
          columns: [
            { type: 'FLEX', value: 2 },
            { type: 'FIXED', value: 240 },
            { type: 'FLEX', value: 1 },
          ],
        },
      },
      { type: 'layout', nodeId: 'f', values: { layoutSizingHorizontal: 'FIXED' } },
    ];
    await run(f);
    expect(f.frame.layoutSizingHorizontal).toBe('FIXED');
    expect(f.frame.gridColumnSizes[0].value).toBe(2);
  });
  it('flex rules preserve negative gap and fixed height', async () => {
    const f = createResponsiveFixture();
    f.config.roots[0]!.base = [
      {
        type: 'layout',
        nodeId: 'f',
        values: {
          itemSpacing: { value: -8 },
          primaryAxisAlignItems: 'MAX',
          counterAxisAlignItems: 'BASELINE',
          layoutWrap: 'WRAP',
          counterAxisSpacing: { value: 12 },
        },
      },
    ];
    expect(await run(f)).toEqual({ status: 'applied', changed: true });
    expect(f.frame).toMatchObject({
      itemSpacing: -8,
      height: 120,
      counterAxisAlignItems: 'BASELINE',
    });
    const count = f.writes.length;
    await run(f);
    expect(f.writes).toHaveLength(count);
  });
  it('visibility and public properties need no grid', async () => {
    const f = createResponsiveFixture('instances');
    f.config.roots[0]!.base = [
      { type: 'visibility', nodeId: 'i', values: { visible: false } },
      { type: 'componentProperties', nodeId: 'i', values: { 'Flag#1': true, Size: 'B' } },
    ];
    await run(f);
    expect(f.instance.visible).toBe(false);
    expect(f.instance.componentProperties.Size.value).toBe('B');
  });
  it('preflight rejects before writes, including future breakpoints', async () => {
    const f = createResponsiveFixture();
    f.config.roots[0]!.base = [
      {
        type: 'layout',
        nodeId: 'f',
        values: { counterAxisAlignItems: 'MIN', layoutMode: 'HORIZONTAL' },
      },
    ];
    f.config.roots[0]!.breakpoints[2]!.overrides = [
      {
        type: 'layout',
        nodeId: 'f',
        values: { counterAxisAlignItems: 'BASELINE', layoutMode: 'VERTICAL' },
      },
    ];
    await expect(run(f)).rejects.toMatchObject({ phase: 'validate' });
    expect(f.writes).toEqual([]);
  });
  it.each(['COMPONENT', 'COMPONENT_SET', 'INSTANCE'])(
    'rejects nested root inside %s',
    async type => {
      const f = createResponsiveFixture();
      f.root.parent.type = type;
      f.writes.length = 0;
      await expect(validateResponsiveOwnership(f.api, resolve(f))).rejects.toMatchObject({
        phase: 'validate',
      });
      expect(f.writes).toEqual([]);
    },
  );
  it.each(['COMPONENT', 'COMPONENT_SET'])('rejects writable %s', async type => {
    const f = createResponsiveFixture();
    f.frame.type = type;
    f.writes.length = 0;
    f.config.roots[0]!.base = [{ type: 'visibility', nodeId: 'f', values: { visible: false } }];
    await expect(run(f)).rejects.toMatchObject({ phase: 'validate' });
    expect(f.writes).toEqual([]);
  });
  it('rejects instance internals and overlapping roots', async () => {
    const f = createResponsiveFixture();
    f.frame.parent = f.instance;
    f.config.roots[0]!.base = [{ type: 'visibility', nodeId: 'f', values: { visible: false } }];
    await expect(run(f)).rejects.toMatchObject({ phase: 'validate' });
    f.frame.parent = f.root;
    f.config.roots.push({ rootId: 'f', base: [], breakpoints: [{ minWidth: 0, overrides: [] }] });
    await expect(validateResponsiveOwnership(f.api, resolve(f))).rejects.toMatchObject({
      phase: 'validate',
    });
  });
  it.each(['layoutSizingHorizontal', 'maxWidth'])('never controls root %s', async field => {
    const f = createResponsiveFixture();
    f.config.roots[0]!.base = [
      { type: 'layout', nodeId: 'r', values: { [field]: field === 'maxWidth' ? 100 : 'FIXED' } },
    ];
    await expect(run(f)).rejects.toMatchObject({ phase: 'validate' });
    expect(f.writes).toEqual([]);
  });
  it('rejects horizontal HUG root', async () => {
    const f = createResponsiveFixture();
    f.root.layoutSizingHorizontal = 'HUG';
    f.writes.length = 0;
    await expect(run(f)).rejects.toMatchObject({ phase: 'validate' });
    expect(f.writes).toEqual([]);
  });
  it('checks FILL parent and wrap compatibility', async () => {
    const f = createResponsiveFixture();
    f.root.layoutMode = 'NONE';
    f.writes.length = 0;
    f.config.roots[0]!.base = [
      { type: 'layout', nodeId: 'f', values: { layoutSizingHorizontal: 'FILL' } },
    ];
    await expect(run(f)).rejects.toMatchObject({ phase: 'validate' });
    f.config.roots[0]!.base = [
      { type: 'layout', nodeId: 'f', values: { counterAxisSpacing: { value: 2 } } },
    ];
    await expect(run(f)).rejects.toMatchObject({ phase: 'validate' });
    expect(f.writes).toEqual([]);
  });
  it('clears maxWidth and binds/unbinds even when the number is unchanged', async () => {
    const f = createResponsiveFixture();
    f.frame.maxWidth = 200;
    f.writes.length = 0;
    f.variables.set('v', {
      id: 'v',
      resolvedType: 'FLOAT',
      resolveForConsumer: () => ({ value: 0, resolvedType: 'FLOAT' }),
    });
    f.config.roots[0]!.base = [
      {
        type: 'layout',
        nodeId: 'f',
        values: { paddingTop: { value: 0, variableId: 'v' }, maxWidth: null },
      },
    ];
    await run(f);
    expect(f.frame.boundVariables.paddingTop.id).toBe('v');
    expect(f.frame.maxWidth).toBeNull();
    f.config.roots[0]!.base[0]!.values = { paddingTop: { value: 0 } };
    await run(f);
    expect(f.frame.boundVariables.paddingTop).toBeUndefined();
  });
  it.each(['wrong-type', 'wrong-value'])('rejects %s variable before writes', async scenario => {
    const f = createResponsiveFixture();
    f.variables.set('v', {
      id: 'v',
      resolvedType: scenario === 'wrong-type' ? 'COLOR' : 'FLOAT',
      resolveForConsumer: () => ({ value: 8, resolvedType: 'FLOAT' }),
    });
    f.config.roots[0]!.base = [
      { type: 'layout', nodeId: 'f', values: { paddingTop: { value: 0, variableId: 'v' } } },
    ];
    await expect(run(f)).rejects.toMatchObject({ phase: 'validate' });
    expect(f.writes).toEqual([]);
  });
  it('rejects individually valid but nonexistent variant combination', async () => {
    const f = createResponsiveFixture('instances');
    f.instance.componentProperties.Tone = { type: 'VARIANT', value: 'X' };
    f.set.children[0]!.variantProperties.Tone = 'X';
    f.set.children[1]!.variantProperties.Tone = 'Y';
    f.config.roots[0]!.base = [
      { type: 'componentProperties', nodeId: 'i', values: { Size: 'A', Tone: 'Y' } },
    ];
    await expect(run(f)).rejects.toMatchObject({ phase: 'validate' });
    expect(f.writes).toEqual([]);
  });
  it.each(['removed', 'moved'])('rechecks cached %s targets before any write', async scenario => {
    const f = createResponsiveFixture();
    f.config.roots[0]!.base = [{ type: 'visibility', nodeId: 'f', values: { visible: false } }];
    const root = resolve(f).roots[0]!;
    const prepared = await prepareResponsiveRoot(f.api, root, 'p');
    if (scenario === 'removed') f.frame.removed = true;
    else f.frame.parent = f.nodes.get('outer');
    f.writes.length = 0;
    expect(() =>
      applyPreparedResponsiveRoot(prepared, evaluateResponsiveRoot(root, 900), () => true),
    ).toThrow(Error);
    expect(f.writes).toEqual([]);
  });
  it('gate cancels before every setter', async () => {
    const f = createResponsiveFixture();
    f.config.roots[0]!.base = [
      {
        type: 'layout',
        nodeId: 'f',
        values: { paddingTop: { value: 4 }, paddingBottom: { value: 8 } },
      },
    ];
    const root = resolve(f).roots[0]!;
    const prepared = await prepareResponsiveRoot(f.api, root, 'p');
    const result = applyPreparedResponsiveRoot(
      prepared,
      evaluateResponsiveRoot(root, 900),
      () => f.writes.length === 0,
    );
    expect(result.status).toBe('cancelled');
    expect(f.writes).toHaveLength(1);
  });
});
