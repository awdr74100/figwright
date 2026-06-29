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

  it('surfaces an actionable error when Figma rejects the position (auto-layout child)', async () => {
    const node = {
      id: '1:1',
      y: 0,
      set x(_v: number) {
        throw new Error('controlled by auto layout');
      },
    };
    await expect(
      createSetPositionHandler(fakeFigma({ '1:1': node }))({ nodeId: '1:1', x: 50 }),
    ).rejects.toThrow(/layoutPositioning ABSOLUTE first/);
  });
});
