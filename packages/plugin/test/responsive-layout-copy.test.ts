import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createResponsiveLayoutController } from '../src/responsive-layout.js';
import { createResponsiveFixture } from './responsive-layout-fixtures.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const fixture = () => {
  const f = createResponsiveFixture();
  f.config.breakpointValues = { md: 820 };
  f.config.roots[0]!.breakpointValues = { md: 800 };
  f.config.roots[0]!.base = [
    { type: 'layout', nodeId: 'f', values: { layoutMode: 'HORIZONTAL' } },
    { type: 'componentProperties', nodeId: 'i', values: { 'Flag#1': false, Size: 'A' } },
  ];
  f.config.roots[0]!.breakpoints[0]!.overrides = [
    { type: 'layout', nodeId: 'f', values: { layoutMode: 'VERTICAL' } },
    { type: 'componentProperties', nodeId: 'i', values: { 'Flag#1': true, Size: 'B' } },
  ];
  return f;
};
const settle = () => vi.advanceTimersByTimeAsync(250);

describe('responsive copied roots', () => {
  it('handles CREATE events and preserves existing variable bindings', async () => {
    const f = fixture();
    f.variables.set('v', {
      id: 'v',
      resolvedType: 'FLOAT',
      resolveForConsumer: () => ({ value: 4, resolvedType: 'FLOAT' }),
    });
    f.config.roots[0]!.base.push({
      type: 'layout',
      nodeId: 'r',
      values: { itemSpacing: { value: 4, variableId: 'v' } },
    });
    const c = createResponsiveLayoutController(f.api);
    c.start();
    await c.configure({ enabled: true, config: f.config });
    const copy = f.cloneNode(f.root, 'copy');
    copy.width = 500;
    f.emitChange({ nodeChanges: [{ type: 'CREATE', id: copy.id, node: copy }] } as NodeChangeEvent);
    await settle();
    expect(c.get().roots[1]).toMatchObject({ rootId: 'copy-r', status: 'active' });
    expect(copy.boundVariables.itemSpacing).toEqual({ type: 'VARIABLE_ALIAS', id: 'v' });
    expect(f.nodes.get('copy-f').layoutMode).toBe('VERTICAL');
    c.dispose();
  });

  it('does not loop or rewrite saved settings on ordinary applies', async () => {
    const f = fixture();
    const c = createResponsiveLayoutController(f.api);
    c.start();
    await c.configure({ enabled: true, config: f.config });
    const setData = vi.spyOn(f.root, 'setPluginData');
    const settings = vi.spyOn(f.api.root, 'setPluginData');
    f.emitChange();
    await settle();
    f.emitChange();
    await settle();
    expect(setData).not.toHaveBeenCalled();
    expect(settings).not.toHaveBeenCalled();
    c.dispose();
  });

  it('refuses excess roots and copies placed inside instances', async () => {
    const f = fixture();
    for (let i = 0; i < 31; i++) {
      const node = f.makeNode(`extra-${i}`, 'FRAME', f.root.parent);
      f.config.roots.push({
        rootId: node.id,
        base: [],
        breakpoints: [{ minWidth: 0, overrides: [] }],
      });
    }
    const c = createResponsiveLayoutController(f.api);
    c.start();
    await c.configure({ enabled: true, config: f.config });
    f.cloneNode(f.root, 'copy');
    f.emitChange();
    await settle();
    expect(c.get().roots).toHaveLength(32);
    expect(c.get().copyErrors?.[0]?.message).toContain('32');
    const container = f.makeNode('protected-container', 'INSTANCE', f.root.parent);
    const inside = f.cloneNode(f.root, 'inside', container);
    f.emitChange({
      nodeChanges: [{ type: 'CREATE', id: inside.id, node: inside }],
    } as NodeChangeEvent);
    await settle();
    expect(c.get().copyErrors?.some(e => e.rootId === inside.id)).toBe(false);
    expect(c.get().roots).toHaveLength(32);
    c.dispose();
  });
  it('remaps nested copied roots and their actions without writing the source', async () => {
    const f = fixture();
    const c = createResponsiveLayoutController(f.api);
    c.start();
    await c.configure({ enabled: true, config: f.config });
    const copy = f.cloneNode(f.root, 'copy');
    copy.width = 799;
    f.writes.length = 0;
    f.emitChange();
    await settle();
    expect(c.get().roots.map(r => r.rootId)).toEqual(['r', 'copy-r']);
    expect(c.get().roots[1]).toMatchObject({ status: 'active', width: 799, minWidth: 0 });
    expect(f.nodes.get('copy-f').layoutMode).toBe('VERTICAL');
    expect(f.nodes.get('copy-i').componentProperties.Size.value).toBe('B');
    expect(f.writes.every(w => w.nodeId.startsWith('copy-'))).toBe(true);
    expect(c.get().effectiveBreakpoints[1]!.breakpoints.map(b => b.minWidth)).toEqual([
      0, 800, 1024,
    ]);
    copy.width = 800;
    f.emitChange();
    await settle();
    expect(f.nodes.get('copy-f').layoutMode).toBe('HORIZONTAL');
    expect(f.nodes.get('copy-i').componentProperties.Size.value).toBe('A');
    c.dispose();
  });

  it('inherits when a copy is copied again and persists both identities after reopen', async () => {
    const f = fixture();
    const c = createResponsiveLayoutController(f.api);
    c.start();
    await c.configure({ enabled: true, config: f.config });
    const first = f.cloneNode(f.root, 'copy');
    first.width = 500;
    f.emitChange();
    await settle();
    const second = f.cloneNode(first, 'next');
    second.width = 1200;
    f.emitChange();
    await settle();
    expect(c.get().roots.map(r => r.status)).toEqual(['active', 'active', 'active']);
    expect(f.nodes.get('next-copy-f').layoutMode).toBe('HORIZONTAL');
    c.dispose();
    const reopened = createResponsiveLayoutController(f.api);
    reopened.start();
    await settle();
    expect(reopened.get().roots.map(r => r.rootId)).toEqual(['r', 'copy-r', 'next-copy-r']);
    expect(reopened.get().roots.every(r => r.status === 'active')).toBe(true);
    reopened.dispose();
  });

  it('finds a copy made while closed, but disabled startup never enrolls or writes it', async () => {
    const f = fixture();
    const c = createResponsiveLayoutController(f.api);
    c.start();
    await c.configure({ enabled: true, config: f.config });
    await c.configure({ enabled: false });
    c.dispose();
    const copy = f.cloneNode(f.root, 'copy');
    copy.width = 500;
    f.writes.length = 0;
    const saved = f.saved.get('responsive_layout');
    const reopened = createResponsiveLayoutController(f.api);
    reopened.start();
    await settle();
    expect(reopened.get().roots).toHaveLength(1);
    expect(f.saved.get('responsive_layout')).toBe(saved);
    expect(f.writes).toEqual([]);
    await reopened.configure({ enabled: true });
    expect(reopened.get().roots[1]).toMatchObject({ rootId: 'copy-r', status: 'active' });
    expect(f.nodes.get('copy-f').layoutMode).toBe('VERTICAL');
    reopened.dispose();
  });

  it('does not adopt unrelated frames, other pages, changed trees or stale removed rules', async () => {
    const f = fixture();
    const c = createResponsiveLayoutController(f.api);
    c.start();
    await c.configure({ enabled: true, config: f.config });
    const copy = f.cloneNode(f.root, 'copy');
    f.nodes.get('copy-f').name = 'changed';
    f.makeNode('unrelated', 'FRAME', copy.parent);
    f.emitChange();
    await settle();
    expect(c.get().roots).toHaveLength(1);
    expect(c.get().copyErrors?.[0]).toMatchObject({ rootId: 'copy-r' });
    const other = f.makeNode('other', 'PAGE', f.api.root);
    f.cloneNode(f.root, 'other', other);
    f.switchPage('other');
    await settle();
    expect(c.get().roots).toHaveLength(1);
    f.switchPage('p');
    await settle();
    await c.configure({
      enabled: true,
      config: {
        ...f.config,
        roots: [{ rootId: 'outer', base: [], breakpoints: [{ minWidth: 0, overrides: [] }] }],
      },
    });
    f.nodes.get('copy-f').name = f.frame.name;
    f.emitChange();
    await settle();
    expect(c.get().roots.map(r => r.rootId)).toEqual(['outer']);
    c.dispose();
  });

  it('removes deleted inherited identities while retaining explicit roots and saved rules', async () => {
    const f = fixture();
    const c = createResponsiveLayoutController(f.api);
    c.start();
    await c.configure({ enabled: true, config: f.config });
    const copy = f.cloneNode(f.root, 'copy');
    f.emitChange();
    await settle();
    expect(c.get().roots).toHaveLength(2);
    copy.removed = true;
    f.nodes.delete(copy.id);
    f.emitChange();
    await settle();
    expect(c.get().config).toEqual(f.config);
    expect(c.get().roots.map(r => r.rootId)).toEqual(['r']);
    f.root.removed = true;
    f.nodes.delete(f.root.id);
    f.emitChange();
    await settle();
    expect(c.get().roots[0]).toMatchObject({ rootId: 'r', status: 'error' });
    c.dispose();
  });
});
