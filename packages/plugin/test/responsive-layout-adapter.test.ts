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
