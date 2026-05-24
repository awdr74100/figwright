import type { MutateResult } from '@figma-mcp-relay/shared';
import { describe, expect, it } from 'vitest';

import { createSetTextPropertiesHandler } from '../../src/handlers/set-text-properties.js';

const fakeFigma = (node: unknown): typeof figma =>
  ({ getNodeByIdAsync: async (id: string) => (id === '1:1' ? node : null) }) as unknown as typeof figma;

describe('set_text_properties handler', () => {
  it('sets truncation / maxLines / autoResize on a TEXT node', async () => {
    const node = { id: '1:1', type: 'TEXT', textTruncation: 'DISABLED', maxLines: null, textAutoResize: 'NONE' };
    const handler = createSetTextPropertiesHandler(fakeFigma(node));
    const result = (await handler({
      nodeId: '1:1',
      textAutoResize: 'HEIGHT',
      textTruncation: 'ENDING',
      maxLines: 2,
    })) as MutateResult;

    expect(node).toMatchObject({ textAutoResize: 'HEIGHT', textTruncation: 'ENDING', maxLines: 2 });
    expect(result).toEqual({ ok: true, nodeId: '1:1' });
  });

  it('leaves omitted fields untouched (partial update)', async () => {
    const node = { id: '1:1', type: 'TEXT', textTruncation: 'ENDING', maxLines: 3, textAutoResize: 'HEIGHT' };
    await createSetTextPropertiesHandler(fakeFigma(node))({ nodeId: '1:1', maxLines: null });
    expect(node).toMatchObject({ textTruncation: 'ENDING', maxLines: null, textAutoResize: 'HEIGHT' });
  });

  it('throws on non-TEXT node, missing node, or bad input', async () => {
    await expect(
      createSetTextPropertiesHandler(fakeFigma({ id: '1:1', type: 'FRAME' }))({ nodeId: '1:1', maxLines: 2 }),
    ).rejects.toThrow(/not a TEXT node/);
    await expect(
      createSetTextPropertiesHandler(fakeFigma(null))({ nodeId: '9:9' }),
    ).rejects.toThrow(/not a TEXT node/);
    await expect(createSetTextPropertiesHandler(fakeFigma(null))({})).rejects.toThrow(/nodeId/);
    await expect(
      createSetTextPropertiesHandler(fakeFigma({ id: '1:1', type: 'TEXT' }))({ nodeId: '1:1', maxLines: 'x' }),
    ).rejects.toThrow(/maxLines/);
  });
});
