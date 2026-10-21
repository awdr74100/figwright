import type { CreateResult } from '@figwright/shared';
import { describe, expect, it, vi } from 'vitest';

import { createRepeatNodesHandler, createSetRepeatHandler } from '../../src/handlers/repeat.js';

const setup = () => {
  const parent = { id: '0:1', type: 'FRAME', appendChild: () => {}, children: [] as unknown[] };
  const mk = (id: string, type = 'RECTANGLE') => {
    const n = { id, type, parent };
    parent.children.push(n);
    return n;
  };
  const a = mk('1:1');
  const b = mk('1:2');
  const top = mk('1:3');
  const group = { id: '5:1', type: 'TRANSFORM_GROUP', transformModifiers: [] as unknown[] };
  const nodes: Record<string, unknown> = { '1:1': a, '1:2': b, '1:3': top, '5:1': group };
  const transformGroup = vi.fn<(...args: unknown[]) => unknown>(() => ({
    id: '9:1',
    name: 'Repeat group',
    type: 'TRANSFORM_GROUP',
  }));
  const ctx = {
    getNodeByIdAsync: async (id: string) => nodes[id] ?? null,
    transformGroup,
  } as unknown as typeof figma;
  return { ctx, parent, a, b, top, group, transformGroup };
};

const LINEAR = { repeatType: 'LINEAR', count: 3, offset: 10 };

describe('repeat_nodes handler', () => {
  it('wraps the nodes at the topmost one’s index, filling in Figma’s defaults', async () => {
    const t = setup();
    const result = (await createRepeatNodesHandler(t.ctx)({
      nodeIds: ['1:3', '1:1'],
      modifiers: [LINEAR, { type: 'REPEAT', repeatType: 'RADIAL', count: 12, offset: 70 }],
    })) as CreateResult;
    expect(t.transformGroup).toHaveBeenCalledWith([t.a, t.top], t.parent, 2, [
      {
        type: 'REPEAT',
        unitType: 'PIXELS',
        offset: 10,
        count: 3,
        repeatType: 'LINEAR',
        axis: 'HORIZONTAL',
      },
      { type: 'REPEAT', unitType: 'PIXELS', offset: 70, count: 12, repeatType: 'RADIAL' },
    ]);
    expect(result).toEqual({
      ok: true,
      nodeId: '9:1',
      name: 'Repeat group',
      type: 'TRANSFORM_GROUP',
    });
  });

  it.each([
    [[], 'at least one modifier'],
    [[LINEAR, LINEAR, LINEAR], 'at most 2'],
    [[{ ...LINEAR, count: 1 }], 'from 2 to 40'],
    [[{ ...LINEAR, count: 41 }], 'from 2 to 40'],
    [[{ ...LINEAR, count: 2.5 }], 'from 2 to 40'],
    [[{ repeatType: 'RADIAL', count: 4, offset: 10, axis: 'VERTICAL' }], 'takes no axis'],
    [[{ ...LINEAR, repeatType: 'SPIRAL' }], 'LINEAR or RADIAL'],
    [[{ ...LINEAR, type: 'SKEW' }], 'must be REPEAT'],
    [[{ ...LINEAR, offset: Number.NaN }], 'offset must be a number'],
  ])('refuses %j before touching the canvas', async (modifiers, message) => {
    const t = setup();
    await expect(createRepeatNodesHandler(t.ctx)({ nodeIds: ['1:1'], modifiers })).rejects.toThrow(
      message,
    );
    expect(t.transformGroup).not.toHaveBeenCalled();
  });
});

describe('set_repeat handler', () => {
  it('replaces a repeat group’s modifiers, an empty list included', async () => {
    const t = setup();
    await createSetRepeatHandler(t.ctx)({ nodeId: '5:1', modifiers: [LINEAR] });
    expect(t.group.transformModifiers).toEqual([
      {
        type: 'REPEAT',
        unitType: 'PIXELS',
        offset: 10,
        count: 3,
        repeatType: 'LINEAR',
        axis: 'HORIZONTAL',
      },
    ]);
    await createSetRepeatHandler(t.ctx)({ nodeId: '5:1', modifiers: [] });
    expect(t.group.transformModifiers).toEqual([]);
  });

  it('refuses a node that is not a repeat group', async () => {
    const t = setup();
    await expect(
      createSetRepeatHandler(t.ctx)({ nodeId: '1:1', modifiers: [LINEAR] }),
    ).rejects.toThrow('not a repeat group');
  });
});
