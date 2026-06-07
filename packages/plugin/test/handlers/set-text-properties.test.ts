import type { MutateResult } from '@figma-mcp-relay/shared';
import { describe, expect, it, vi } from 'vitest';

import { createSetTextPropertiesHandler } from '../../src/handlers/set-text-properties.js';

const MIXED = Symbol('mixed');

const fakeFigma = (
  node: unknown,
  loadFontAsync = vi.fn<() => Promise<void>>(async () => {}),
): typeof figma =>
  ({
    mixed: MIXED,
    loadFontAsync,
    getNodeByIdAsync: async (id: string) => (id === '1:1' ? node : null),
  }) as unknown as typeof figma;

describe('set_text_properties handler', () => {
  it('sets truncation / maxLines / autoResize on a TEXT node', async () => {
    const node = {
      id: '1:1',
      type: 'TEXT',
      textTruncation: 'DISABLED',
      maxLines: null,
      textAutoResize: 'NONE',
    };
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
    const node = {
      id: '1:1',
      type: 'TEXT',
      textTruncation: 'ENDING',
      maxLines: 3,
      textAutoResize: 'HEIGHT',
    };
    await createSetTextPropertiesHandler(fakeFigma(node))({ nodeId: '1:1', maxLines: null });
    expect(node).toMatchObject({
      textTruncation: 'ENDING',
      maxLines: null,
      textAutoResize: 'HEIGHT',
    });
  });

  it('sets typography after loading the node font and the new fontName', async () => {
    const loadFontAsync = vi.fn<() => Promise<void>>(async () => {});
    const node = {
      id: '1:1',
      type: 'TEXT',
      characters: 'hi',
      fontName: { family: 'Inter', style: 'Regular' },
      fontSize: 12,
      lineHeight: { unit: 'AUTO' },
      letterSpacing: { unit: 'PERCENT', value: 0 },
      textCase: 'ORIGINAL',
      textDecoration: 'NONE',
    };
    const handler = createSetTextPropertiesHandler(fakeFigma(node, loadFontAsync));
    await handler({
      nodeId: '1:1',
      fontName: { family: 'Roboto', style: 'Bold' },
      fontSize: 24,
      lineHeight: { unit: 'PIXELS', value: 32 },
      letterSpacing: { unit: 'PIXELS', value: 1 },
      textCase: 'UPPER',
      textDecoration: 'UNDERLINE',
    });

    // both the node's current font and the new target font get loaded before mutation
    expect(loadFontAsync).toHaveBeenCalledWith({ family: 'Inter', style: 'Regular' });
    expect(loadFontAsync).toHaveBeenCalledWith({ family: 'Roboto', style: 'Bold' });
    expect(node).toMatchObject({
      fontName: { family: 'Roboto', style: 'Bold' },
      fontSize: 24,
      lineHeight: { unit: 'PIXELS', value: 32 },
      letterSpacing: { unit: 'PIXELS', value: 1 },
      textCase: 'UPPER',
      textDecoration: 'UNDERLINE',
    });
  });

  it('does not load fonts when only layout/overflow props change', async () => {
    const loadFontAsync = vi.fn<() => Promise<void>>(async () => {});
    const node = { id: '1:1', type: 'TEXT', textAutoResize: 'NONE' };
    await createSetTextPropertiesHandler(fakeFigma(node, loadFontAsync))({
      nodeId: '1:1',
      textAutoResize: 'HEIGHT',
    });
    expect(loadFontAsync).not.toHaveBeenCalled();
    expect(node.textAutoResize).toBe('HEIGHT');
  });

  it('throws on non-TEXT node, missing node, or bad input', async () => {
    await expect(
      createSetTextPropertiesHandler(fakeFigma({ id: '1:1', type: 'FRAME' }))({
        nodeId: '1:1',
        maxLines: 2,
      }),
    ).rejects.toThrow(/not a TEXT node/);
    await expect(
      createSetTextPropertiesHandler(fakeFigma(null))({ nodeId: '9:9' }),
    ).rejects.toThrow(/not a TEXT node/);
    await expect(createSetTextPropertiesHandler(fakeFigma(null))({})).rejects.toThrow(/nodeId/);
    await expect(
      createSetTextPropertiesHandler(fakeFigma({ id: '1:1', type: 'TEXT' }))({
        nodeId: '1:1',
        maxLines: 'x',
      }),
    ).rejects.toThrow(/maxLines/);
  });
});
