import type { MutateResult } from '@figma-mcp-relay/shared';
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
});
