import { readFileSync } from 'node:fs';

import { ResponsiveLayoutConfigureInputSchema } from '@figwright/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createResponsiveLayoutController } from '../src/responsive-layout.js';
import { createResponsiveFixture } from './responsive-layout-fixtures.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
describe('independent responsive layouts', () => {
  it.each(['flex', 'grid', 'instances'] as const)(
    'same interface controls unrelated %s structures',
    async kind => {
      const f = createResponsiveFixture(kind);
      const c = createResponsiveLayoutController(f.api);
      c.start();
      const rule = f.config.roots[0]!;
      if (kind === 'flex') {
        rule.base = [
          {
            type: 'layout',
            nodeId: 'f',
            values: {
              layoutMode: 'VERTICAL',
              itemSpacing: { value: -8 },
              layoutWrap: 'WRAP',
              layoutSizingVertical: 'FIXED',
              counterAxisAlignItems: 'MIN',
              primaryAxisAlignItems: 'SPACE_AROUND',
            },
          },
        ];
        rule.breakpoints[1]!.overrides = [
          {
            type: 'layout',
            nodeId: 'f',
            values: { layoutMode: 'HORIZONTAL', counterAxisAlignItems: 'BASELINE' },
          },
        ];
      } else if (kind === 'grid') {
        rule.base = [
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
              gridAutoTracks: 'NONE',
              gridItemsPositioning: 'MANUAL',
            },
          },
          { type: 'layout', nodeId: 'f', values: { layoutSizingHorizontal: 'FIXED' } },
        ];
        rule.breakpoints[1]!.overrides = [
          {
            type: 'grid',
            nodeId: 'f',
            values: { columns: [{ type: 'HUG' }, { type: 'HUG' }, { type: 'HUG' }] },
          },
          { type: 'layout', nodeId: 'f', values: { layoutSizingHorizontal: 'HUG' } },
        ];
      } else {
        rule.base = [
          { type: 'visibility', nodeId: 'i', values: { visible: true } },
          { type: 'componentProperties', nodeId: 'i', values: { Size: 'A', 'Flag#1': false } },
        ];
        rule.breakpoints[1]!.overrides = [
          { type: 'visibility', nodeId: 'i', values: { visible: false } },
          { type: 'componentProperties', nodeId: 'i', values: { Size: 'B', 'Flag#1': true } },
        ];
      }
      const ids = f.root.children.map((n: { id: string }) => n.id);
      const names = f.root.children.map((n: { name: string }) => n.name);
      expect((await c.configure({ enabled: true, config: f.config })).applied).toBe(true);
      for (const width of [767, 768, 1024, 767]) {
        f.setWidth(width);
        f.emitChange();
        await vi.advanceTimersByTimeAsync(120);
        const middle = width === 768;
        expect(c.get().roots[0]!.minWidth).toBe(width === 1024 ? 1024 : middle ? 768 : 0);
        const observed =
          kind === 'flex'
            ? { mode: f.frame.layoutMode, gap: f.frame.itemSpacing, wrap: f.frame.layoutWrap }
            : kind === 'grid'
              ? { track: f.frame.gridColumnSizes[0].type, sizing: f.frame.layoutSizingHorizontal }
              : {
                  visible: f.instance.visible,
                  size: f.instance.componentProperties.Size.value,
                  flag: f.instance.componentProperties['Flag#1'].value,
                };
        const expected =
          kind === 'flex'
            ? { mode: middle ? 'HORIZONTAL' : 'VERTICAL', gap: -8, wrap: 'WRAP' }
            : kind === 'grid'
              ? { track: middle ? 'HUG' : 'FLEX', sizing: middle ? 'HUG' : 'FIXED' }
              : { visible: !middle, size: middle ? 'B' : 'A', flag: middle };
        expect(observed).toEqual(expected);
        expect(f.root.children.map((n: { id: string }) => n.id)).toEqual(ids);
        expect(f.root.children.map((n: { name: string }) => n.name)).toEqual(names);
        expect(f.frame.height).toBe(120);
      }
      // Renaming and adding an ordinary ancestor do not change any rule semantics.
      const wrapper = f.makeNode('unrelated-wrapper', 'FRAME', f.nodes.get('outer'));
      f.root.parent = wrapper;
      f.root.name = 'other-label';
      f.writes.length = 0;
      expect((await c.configure({ enabled: true, config: f.config })).applied).toBe(true);
      expect(f.writes).toEqual([]);
      await c.configure({ enabled: false });
      f.writes.length = 0;
      f.setWidth(900);
      f.writes.length = 0;
      f.emitChange();
      await vi.advanceTimersByTimeAsync(120);
      expect(f.writes).toEqual([]);
      c.dispose();
    },
  );
  it('no actions means no automatic style or layout', async () => {
    const f = createResponsiveFixture();
    const c = createResponsiveLayoutController(f.api);
    c.start();
    expect((await c.configure({ enabled: true, config: f.config })).applied).toBe(true);
    expect(f.writes).toEqual([]);
    c.dispose();
  });
  it('automatic GRID row policy survives breakpoint round trips', async () => {
    const f = createResponsiveFixture('grid');
    const c = createResponsiveLayoutController(f.api);
    c.start();
    const rule = f.config.roots[0]!;
    rule.base = [
      {
        type: 'grid',
        nodeId: 'f',
        values: {
          gridAutoTracks: 'ROWS',
          gridItemsPositioning: 'ROW_AUTO_FLOW',
          autoRowTrack: { type: 'FIXED', value: 96 },
          columns: [
            { type: 'FLEX', value: 2 },
            { type: 'FLEX', value: 1 },
          ],
        },
      },
    ];
    rule.breakpoints[1]!.overrides = [
      { type: 'grid', nodeId: 'f', values: { columns: [{ type: 'FIXED', value: 120 }] } },
    ];
    expect((await c.configure({ enabled: true, config: f.config })).applied).toBe(true);
    for (const width of [767, 768, 1024, 767]) {
      f.setWidth(width);
      f.emitChange();
      await vi.advanceTimersByTimeAsync(120);
      expect(c.get().roots[0]!.status).toBe('active');
      expect(
        f.frame.gridRowSizes.every(
          (t: { type: string; value: number }) => t.type === 'FIXED' && t.value === 96,
        ),
      ).toBe(true);
    }
    c.dispose();
  });
  it('the documented configuration example executes through the same schema and controller', async () => {
    const guide = readFileSync(
      new URL('../../../skills/figma-build/references/write-rules.md', import.meta.url),
      'utf8',
    );
    const json = guide.match(/```json\n([\s\S]*?)\n```/)?.[1];
    const input = ResponsiveLayoutConfigureInputSchema.parse(JSON.parse(json ?? '{}'));
    const f = createResponsiveFixture();
    const c = createResponsiveLayoutController(f.api);
    c.start();
    expect((await c.configure(input)).applied).toBe(true);
    expect(c.get().effectiveBreakpoints[0]!.breakpoints.map(b => b.minWidth)).toEqual([0, 800]);
    c.dispose();
  });
});
