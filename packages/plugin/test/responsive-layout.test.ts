import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createResponsiveLayoutController } from '../src/responsive-layout.js';
import { createResponsiveFixture } from './responsive-layout-fixtures.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const fixture = () => {
  const f = createResponsiveFixture();
  f.config.roots[0]!.base = [{ type: 'visibility', nodeId: 'f', values: { visible: true } }];
  f.config.roots[0]!.breakpoints[1]!.overrides = [
    { type: 'visibility', nodeId: 'f', values: { visible: false } },
  ];
  return f;
};
describe('responsive lifecycle', () => {
  it('disabled startup does not watch scan or write or read legacy data', () => {
    const f = fixture();
    const lookup = vi.spyOn(f.api, 'getNodeByIdAsync');
    const data = vi.spyOn(f.api.root, 'getPluginData');
    const c = createResponsiveLayoutController(f.api);
    c.start();
    c.start();
    c.get();
    expect(lookup).not.toHaveBeenCalled();
    expect(f.listeners.get('nodechange')?.size ?? 0).toBe(0);
    expect(f.writes).toEqual([]);
    expect(data.mock.calls).toEqual([['responsive_layout']]);
    c.dispose();
    c.dispose();
  });
  it.each(['lookup', 'variable', 'component'])(
    'stale %s async work never writes when disabled replaced or switched',
    async seam => {
      for (const operation of ['disable', 'replace', 'page']) {
        const f = fixture();
        const c = createResponsiveLayoutController(f.api);
        c.start();
        let release!: () => void;
        const blocked = new Promise<void>(r => {
          release = r;
        });
        if (seam === 'lookup') {
          const original = f.api.getNodeByIdAsync;
          vi.spyOn(f.api, 'getNodeByIdAsync').mockImplementation(async id => {
            if (id === 'f') await blocked;
            return original(id);
          });
        }
        if (seam === 'variable') {
          f.config.roots[0]!.base = [
            { type: 'layout', nodeId: 'f', values: { paddingTop: { value: 4, variableId: 'v' } } },
          ];
          f.config.roots[0]!.breakpoints[1]!.overrides = [];
          vi.spyOn(f.api.variables, 'getVariableByIdAsync').mockImplementation(async () => {
            await blocked;
            return {
              id: 'v',
              resolvedType: 'FLOAT',
              resolveForConsumer: () => ({ value: 4, resolvedType: 'FLOAT' }),
            } as unknown as Variable;
          });
        }
        if (seam === 'component') {
          f.config.roots[0]!.base = [
            { type: 'componentProperties', nodeId: 'i', values: { Size: 'B' } },
          ];
          f.config.roots[0]!.breakpoints[1]!.overrides = [];
          f.instance.getMainComponentAsync = async () => {
            await blocked;
            return f.main;
          };
        }
        f.writes.length = 0;
        const work = c.configure({ enabled: true, config: f.config }).catch(() => undefined);
        await vi.advanceTimersByTimeAsync(0);
        if (operation === 'disable') await c.configure({ enabled: false });
        if (operation === 'replace')
          await c.configure({
            enabled: true,
            config: {
              ...f.config,
              roots: [{ rootId: 'r', base: [], breakpoints: [{ minWidth: 0, overrides: [] }] }],
            },
          });
        if (operation === 'page') f.switchPage('other');
        release();
        await work;
        await vi.advanceTimersByTimeAsync(0);
        expect(f.writes).toEqual([]);
        c.dispose();
      }
    },
  );
  it('saved overrides survive reopen without scans while disabled', async () => {
    const f = fixture();
    f.config.breakpointValues = { md: 820 };
    f.config.roots[0]!.breakpointValues = { md: 800 };
    const c = createResponsiveLayoutController(f.api);
    c.start();
    await c.configure({ enabled: false, config: f.config });
    c.dispose();
    const lookup = vi.spyOn(f.api, 'getNodeByIdAsync');
    const reopened = createResponsiveLayoutController(f.api);
    reopened.start();
    expect(reopened.get().effectiveBreakpoints[0]!.breakpoints.map(b => b.minWidth)).toEqual([
      0, 800, 1024,
    ]);
    expect(lookup).not.toHaveBeenCalled();
    expect(f.listeners.get('nodechange')?.size ?? 0).toBe(0);
    reopened.dispose();
  });
  it('one failed root does not mask another and errors require configure', async () => {
    const f = fixture();
    const second = f.makeNode('r2', 'FRAME', f.nodes.get('outer'));
    f.makeNode('f2', 'FRAME', second);
    f.config.roots.push({
      rootId: 'r2',
      base: [{ type: 'visibility', nodeId: 'f2', values: { visible: false } }],
      breakpoints: [{ minWidth: 0, overrides: [] }],
    });
    let throws = true;
    Object.defineProperty(f.nodes.get('f2'), 'visible', {
      configurable: true,
      get: () => true,
      set: () => {
        if (throws) throw new Error('setter failed');
      },
    });
    f.writes.length = 0;
    const c = createResponsiveLayoutController(f.api);
    c.start();
    const result = await c.configure({ enabled: true, config: f.config });
    expect(result.accepted).toBe(true);
    expect(result.applied).toBe(false);
    expect(result.roots.map(r => r.status)).toEqual(['active', 'error']);
    expect(result.roots[1]!.error?.phase).toBe('apply');
    throws = false;
    f.emitChange();
    await vi.advanceTimersByTimeAsync(120);
    expect(c.get().roots[1]!.status).toBe('error');
    expect((await c.configure({ enabled: true })).roots[1]!.status).toBe('active');
    c.dispose();
  });
  it('invalid ownership never replaces the saved or accepted configuration', async () => {
    const f = fixture();
    const c = createResponsiveLayoutController(f.api);
    c.start();
    await c.configure({ enabled: true, config: f.config });
    const before = f.saved.get('responsive_layout');
    await expect(
      c.configure({ enabled: true, config: { ...f.config, pageId: 'other' } }),
    ).rejects.toThrow(Error);
    expect(f.saved.get('responsive_layout')).toBe(before);
    expect(c.get().config).toEqual(f.config);
    c.dispose();
  });
  it('future invalid properties reject a root before any writes', async () => {
    const f = fixture();
    f.config.roots[0]!.base = [{ type: 'componentProperties', nodeId: 'i', values: { Size: 'A' } }];
    f.config.roots[0]!.breakpoints[1]!.overrides = [
      { type: 'componentProperties', nodeId: 'i', values: { Size: 'missing' } },
    ];
    const c = createResponsiveLayoutController(f.api);
    c.start();
    const result = await c.configure({ enabled: true, config: f.config });
    expect(result.roots[0]!.status).toBe('error');
    expect(result.roots[0]!.error?.phase).toBe('validate');
    expect(f.writes).toEqual([]);
    c.dispose();
  });
  it('switching pages pauses and return revalidates, disable removes listeners', async () => {
    const f = fixture();
    const c = createResponsiveLayoutController(f.api);
    c.start();
    await c.configure({ enabled: true, config: f.config });
    f.switchPage('other');
    expect(c.get().roots[0]!.status).toBe('paused');
    expect(f.listeners.get('nodechange')?.size ?? 0).toBe(0);
    f.frame.removed = true;
    f.switchPage('p');
    await vi.advanceTimersByTimeAsync(120);
    expect(c.get().roots[0]!.status).toBe('error');
    await c.configure({ enabled: false });
    expect(f.listeners.get('nodechange')?.size ?? 0).toBe(0);
    c.dispose();
  });
  it('120ms debounce reads latest width and repairs controlled manual edits without loops', async () => {
    const f = fixture();
    const c = createResponsiveLayoutController(f.api);
    c.start();
    await c.configure({ enabled: true, config: f.config });
    f.setWidth(500);
    f.emitChange();
    await vi.advanceTimersByTimeAsync(100);
    expect(f.frame.visible).toBe(false);
    f.setWidth(1100);
    f.emitChange();
    await vi.advanceTimersByTimeAsync(119);
    expect(f.frame.visible).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.frame.visible).toBe(true);
    expect(c.get().roots[0]!.minWidth).toBe(1024);
    f.frame.visible = false;
    f.writes.length = 0;
    f.emitChange();
    await vi.advanceTimersByTimeAsync(120);
    expect(f.frame.visible).toBe(true);
    const count = f.writes.length;
    f.emitChange();
    await vi.advanceTimersByTimeAsync(120);
    expect(f.writes).toHaveLength(count);
    c.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['broken', '{"version":99}'])(
    'corrupt or unknown saved data stays disabled: %s',
    value => {
      const f = fixture();
      f.saved.set('responsive_layout', value);
      const lookup = vi.spyOn(f.api, 'getNodeByIdAsync');
      const c = createResponsiveLayoutController(f.api);
      c.start();
      expect(c.get()).toMatchObject({ enabled: false, error: { phase: 'load' } });
      expect(lookup).not.toHaveBeenCalled();
      c.dispose();
    },
  );
  it('copied saved data with missing ids reports resolve error without design writes', async () => {
    const f = fixture();
    const c = createResponsiveLayoutController(f.api);
    c.start();
    await c.configure({ enabled: true, config: f.config });
    c.dispose();
    f.nodes.delete('f');
    f.writes.length = 0;
    const copied = createResponsiveLayoutController(f.api);
    copied.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(copied.get().roots[0]!.error?.phase).toBe('resolve');
    expect(f.writes).toEqual([]);
    copied.dispose();
  });
});
