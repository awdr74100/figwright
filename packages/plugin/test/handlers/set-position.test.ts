import type { MutateResult } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import { createSetPositionHandler } from '../../src/handlers/set-position.js';

const fakeFigma = (lookup: Record<string, unknown>): typeof figma =>
  ({ getNodeByIdAsync: async (id: string) => lookup[id] ?? null }) as unknown as typeof figma;

describe('set_position handler', () => {
  it('sets x and y (parent-relative)', async () => {
    const node = { id: '1:1', x: 0, y: 0 };
    const result = (await createSetPositionHandler(fakeFigma({ '1:1': node }))({
      nodeId: '1:1',
      x: 120,
      y: 40,
    })) as MutateResult;

    expect(node).toMatchObject({ x: 120, y: 40 });
    expect(result).toEqual({ ok: true, nodeId: '1:1' });
  });

  it('leaves an omitted axis unchanged', async () => {
    const node = { id: '1:1', x: 10, y: 20 };
    await createSetPositionHandler(fakeFigma({ '1:1': node }))({ nodeId: '1:1', x: 99 });
    expect(node).toMatchObject({ x: 99, y: 20 });
  });

  it('throws on missing node, a node without position, or bad input', async () => {
    await expect(createSetPositionHandler(fakeFigma({}))({ nodeId: '9:9' })).rejects.toThrow(
      /not found/,
    );
    await expect(
      createSetPositionHandler(fakeFigma({ '1:1': { id: '1:1' } }))({ nodeId: '1:1', x: 1 }),
    ).rejects.toThrow(/no position/);
    await expect(createSetPositionHandler(fakeFigma({}))({})).rejects.toThrow(/nodeId/);
    await expect(
      createSetPositionHandler(fakeFigma({ '1:1': { id: '1:1', x: 0, y: 0 } }))({
        nodeId: '1:1',
        x: 'nope',
      }),
    ).rejects.toThrow(/x must be a number/);
  });

  it('refuses an in-flow auto-layout child up front (Figma would silently reflow it)', async () => {
    const node = {
      id: '1:1',
      x: 16,
      y: 16,
      layoutPositioning: 'AUTO',
      parent: { layoutMode: 'VERTICAL' },
    };
    await expect(
      createSetPositionHandler(fakeFigma({ '1:1': node }))({ nodeId: '1:1', x: 200 }),
    ).rejects.toThrow(/layoutPositioning ABSOLUTE/);
    expect(node.x).toBe(16); // not written
  });

  it('allows an ABSOLUTE child of an auto-layout frame', async () => {
    const node = {
      id: '1:1',
      x: 0,
      y: 0,
      layoutPositioning: 'ABSOLUTE',
      parent: { layoutMode: 'VERTICAL' },
    };
    await createSetPositionHandler(fakeFigma({ '1:1': node }))({ nodeId: '1:1', x: 200, y: 8 });
    expect(node).toMatchObject({ x: 200, y: 8 });
  });

  it('allows a child of a non-auto-layout parent', async () => {
    const node = {
      id: '1:1',
      x: 0,
      y: 0,
      layoutPositioning: 'AUTO',
      parent: { layoutMode: 'NONE' },
    };
    await createSetPositionHandler(fakeFigma({ '1:1': node }))({ nodeId: '1:1', x: 50 });
    expect(node.x).toBe(50);
  });
});
