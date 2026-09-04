import type { MutateResult } from '@figwright/shared';
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

  it("writes a variable font's axis values through, and loads that exact font", async () => {
    const loadFontAsync = vi.fn<() => Promise<void>>(async () => {});
    const node = {
      id: '1:1',
      type: 'TEXT',
      characters: 'hi',
      fontName: { family: 'Inter', style: 'Regular' },
    };
    await createSetTextPropertiesHandler(fakeFigma(node, loadFontAsync))({
      nodeId: '1:1',
      fontName: { family: 'Inter', style: 'Regular', variationSettings: { wght: 650 } },
    });
    expect(node.fontName).toEqual({
      family: 'Inter',
      style: 'Regular',
      variationSettings: { wght: 650 },
    });
    expect(loadFontAsync).toHaveBeenCalledWith({
      family: 'Inter',
      style: 'Regular',
      variationSettings: { wght: 650 },
    });
  });

  it('accepts a fontName with no style, so Figma resolves the closest named instance', async () => {
    const node = {
      id: '1:1',
      type: 'TEXT',
      characters: 'hi',
      fontName: { family: 'Inter', style: 'Regular' },
    };
    await createSetTextPropertiesHandler(fakeFigma(node))({
      nodeId: '1:1',
      fontName: { family: 'Inter', variationSettings: { wght: 900 } },
    });
    // No `style: undefined` key — Figma reads the presence of the key, not its value.
    expect(node.fontName).toEqual({ family: 'Inter', variationSettings: { wght: 900 } });
    expect(Object.hasOwn(node.fontName, 'style')).toBe(false);
  });

  it('rejects a non-numeric axis value instead of handing it to Figma', async () => {
    const node = {
      id: '1:1',
      type: 'TEXT',
      characters: 'hi',
      fontName: { family: 'Inter', style: 'Regular' },
    };
    await expect(
      createSetTextPropertiesHandler(fakeFigma(node))({
        nodeId: '1:1',
        fontName: { family: 'Inter', variationSettings: { wght: '650' } },
      }),
    ).rejects.toThrow(/variationSettings\.wght must be a number/);
    // Rejected before the write, so the node is untouched.
    expect(node.fontName).toEqual({ family: 'Inter', style: 'Regular' });
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

  it('sets paragraphSpacing / paragraphIndent after loading fonts (they mutate text layout)', async () => {
    const loadFontAsync = vi.fn<() => Promise<void>>(async () => {});
    const node = {
      id: '1:1',
      type: 'TEXT',
      characters: 'First paragraph.\nSecond paragraph.',
      fontName: { family: 'Inter', style: 'Regular' },
      paragraphSpacing: 0,
      paragraphIndent: 0,
    };
    await createSetTextPropertiesHandler(fakeFigma(node, loadFontAsync))({
      nodeId: '1:1',
      paragraphSpacing: 12,
      paragraphIndent: 24,
    });

    expect(loadFontAsync).toHaveBeenCalledWith({ family: 'Inter', style: 'Regular' });
    expect(node).toMatchObject({ paragraphSpacing: 12, paragraphIndent: 24 });
  });

  it('sets textWrapStyle after loading fonts (Figma requires it for this paragraph prop)', async () => {
    const loadFontAsync = vi.fn<() => Promise<void>>(async () => {});
    const node = {
      id: '1:1',
      type: 'TEXT',
      characters: 'A heading long enough to wrap',
      fontName: { family: 'Inter', style: 'Bold' },
      textWrapStyle: 'AUTO',
    };
    await createSetTextPropertiesHandler(fakeFigma(node, loadFontAsync))({
      nodeId: '1:1',
      textWrapStyle: 'BALANCE',
    });

    expect(loadFontAsync).toHaveBeenCalledWith({ family: 'Inter', style: 'Bold' });
    expect(node.textWrapStyle).toBe('BALANCE');
  });

  // Figma refuses these three against an unloaded font exactly as it refuses a typography write,
  // so each is checked on its own: `{nodeId, maxLines: 3}` threw `Cannot write to node with
  // unloaded font` in a real file while `{nodeId, fontSize: 24, maxLines: 3}` went through, which
  // is why the miss survived — any call that also touched typography loaded the font on the way
  // past. A mock cannot reproduce the refusal, so what is pinned here is that the load happens.
  it.each(['textAutoResize', 'textTruncation', 'maxLines'])(
    'loads the node font before writing %s on its own',
    async field => {
      const loadFontAsync = vi.fn<() => Promise<void>>(async () => {});
      const node = {
        id: '1:1',
        type: 'TEXT',
        fontName: { family: 'Inter', style: 'Regular' },
        characters: 'hi',
        textAutoResize: 'NONE',
        textTruncation: 'DISABLED',
        maxLines: null,
      };
      const value = { textAutoResize: 'HEIGHT', textTruncation: 'ENDING', maxLines: 3 }[field];

      await createSetTextPropertiesHandler(fakeFigma(node, loadFontAsync))({
        nodeId: '1:1',
        [field]: value,
      });

      expect(loadFontAsync).toHaveBeenCalledWith({ family: 'Inter', style: 'Regular' });
      expect(node[field as keyof typeof node]).toBe(value);
    },
  );

  it('clears maxLines with an explicit null, still loading the font first', async () => {
    const loadFontAsync = vi.fn<() => Promise<void>>(async () => {});
    const node = {
      id: '1:1',
      type: 'TEXT',
      fontName: { family: 'Inter', style: 'Regular' },
      characters: 'hi',
      maxLines: 3,
    };
    await createSetTextPropertiesHandler(fakeFigma(node, loadFontAsync))({
      nodeId: '1:1',
      maxLines: null,
    });
    expect(loadFontAsync).toHaveBeenCalledWith({ family: 'Inter', style: 'Regular' });
    expect(node.maxLines).toBeNull();
  });

  it('loads nothing when there is nothing to write', async () => {
    const loadFontAsync = vi.fn<() => Promise<void>>(async () => {});
    const node = { id: '1:1', type: 'TEXT', fontName: { family: 'Inter', style: 'Regular' } };
    await createSetTextPropertiesHandler(fakeFigma(node, loadFontAsync))({ nodeId: '1:1' });
    expect(loadFontAsync).not.toHaveBeenCalled();
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
    // Figma rejects negative paragraph values at the API boundary — refuse before touching the node.
    await expect(
      createSetTextPropertiesHandler(fakeFigma({ id: '1:1', type: 'TEXT' }))({
        nodeId: '1:1',
        paragraphSpacing: -1,
      }),
    ).rejects.toThrow(/paragraphSpacing/);
    await expect(
      createSetTextPropertiesHandler(fakeFigma({ id: '1:1', type: 'TEXT' }))({
        nodeId: '1:1',
        paragraphIndent: -1,
      }),
    ).rejects.toThrow(/paragraphIndent/);
    await expect(
      createSetTextPropertiesHandler(fakeFigma({ id: '1:1', type: 'TEXT' }))({
        nodeId: '1:1',
        textWrapStyle: 3,
      }),
    ).rejects.toThrow(/textWrapStyle/);
  });
});
