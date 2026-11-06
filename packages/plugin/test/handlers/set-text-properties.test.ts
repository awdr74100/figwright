import type { MutateResult, TextPropertiesResult } from '@figwright/shared';
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

type Mode = 'NONE' | 'HEIGHT' | 'WIDTH_AND_HEIGHT' | 'TRUNCATE';

/**
 * A TEXT node whose box follows the rules measured in a real file (see text-box.ts):
 *
 * - Resize() fixes the box only when the height changes, carrying the clamp over from auto sizing and
 *   clearing it on an already-fixed box; a width-only resize keeps auto sizing (auto width becoming
 *   auto height) and re-wraps; a same-size resize does nothing.
 * - A fixed box with the ellipsis reads back as TRUNCATE; moving the mode turns the ellipsis off and
 *   clears maxLines, and writing TRUNCATE turns the ellipsis on.
 * - MaxLines reads back only on auto-sized text with the ellipsis on; turning the ellipsis off clears
 *   it, turning it on for auto-sized text that had none sets it to 1.
 * - A vertically centred box moves when auto height re-fits it.
 *
 * Its text is one 400px line at 15px a line, so auto height is 15px per line a width wraps it into,
 * up to maxLines.
 */
const textBox = (init: {
  mode: Mode;
  width?: number;
  height?: number;
  textTruncation?: 'DISABLED' | 'ENDING';
  maxLines?: number | null;
  textAlignVertical?: 'TOP' | 'CENTER';
}) => {
  let mode: Mode = init.mode === 'TRUNCATE' ? 'NONE' : init.mode;
  let width = init.width ?? 400;
  let height = init.height ?? 15;
  let y = 20;
  let truncation: string =
    init.mode === 'TRUNCATE' ? 'ENDING' : (init.textTruncation ?? 'DISABLED');
  let lines: number | null = init.maxLines ?? null;
  const fit = (): void => {
    const before = height;
    if (mode === 'WIDTH_AND_HEIGHT') [width, height] = [400, 15];
    if (mode === 'HEIGHT') {
      const wrapped = Math.ceil(400 / width);
      height =
        15 * (truncation === 'ENDING' && lines !== null ? Math.min(wrapped, lines) : wrapped);
    }
    if (init.textAlignVertical === 'CENTER') y += (before - height) / 2;
  };
  fit();
  y = 20;
  const readMode = (): Mode => (mode === 'NONE' && truncation === 'ENDING' ? 'TRUNCATE' : mode);
  return {
    id: '1:1',
    type: 'TEXT',
    characters: 'x',
    fontName: { family: 'Inter', style: 'Regular' },
    parent: null,
    x: 10,
    get y() {
      return y;
    },
    set y(value: number) {
      y = value;
    },
    get width() {
      return width;
    },
    get height() {
      return height;
    },
    resize(w: number, h: number) {
      if (w === width && h === height) return;
      if (h === height && mode !== 'NONE') {
        width = w;
        if (mode === 'WIDTH_AND_HEIGHT') mode = 'HEIGHT';
        fit();
        return;
      }
      if (mode === 'NONE') lines = null;
      [width, height, mode] = [w, h, 'NONE'];
    },
    get textAutoResize(): Mode {
      return readMode();
    },
    set textAutoResize(value: Mode) {
      if (value !== readMode()) [truncation, lines] = ['DISABLED', null];
      if (value === 'TRUNCATE') [mode, truncation] = ['NONE', 'ENDING'];
      else mode = value;
      fit();
    },
    get textTruncation() {
      return truncation;
    },
    set textTruncation(value: string) {
      if (value === 'DISABLED') lines = null;
      else if (truncation === 'DISABLED' && mode !== 'NONE' && lines === null) lines = 1;
      truncation = value;
      fit();
    },
    get maxLines() {
      return lines;
    },
    set maxLines(value: number | null) {
      if (mode === 'NONE' || truncation !== 'ENDING') return;
      lines = value;
      fit();
    },
  };
};

describe('set_text_properties handler', () => {
  it('sets truncation / maxLines / autoResize on a TEXT node', async () => {
    const node = textBox({ mode: 'NONE', width: 100, height: 40 });
    const handler = createSetTextPropertiesHandler(fakeFigma(node));
    const result = (await handler({
      nodeId: '1:1',
      textAutoResize: 'HEIGHT',
      textTruncation: 'ENDING',
      maxLines: 2,
    })) as MutateResult;

    expect(node).toMatchObject({ textAutoResize: 'HEIGHT', textTruncation: 'ENDING', maxLines: 2 });
    expect(result).toEqual({ ok: true, nodeId: '1:1', width: 100, height: 30 });
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
    const node = textBox({ mode: 'HEIGHT', width: 100, textTruncation: 'ENDING', maxLines: 3 });
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
      // maxLines reads back only with the ellipsis on auto-sized text, so that one starts clamped.
      const node =
        field === 'maxLines'
          ? textBox({ mode: 'HEIGHT', width: 100, textTruncation: 'ENDING', maxLines: 1 })
          : textBox({ mode: 'NONE', width: 100 });
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
    const node = textBox({ mode: 'HEIGHT', width: 100, textTruncation: 'ENDING', maxLines: 3 });
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

describe('set_text_properties text box size', () => {
  const run = async (node: unknown, args: Record<string, unknown>) =>
    (await createSetTextPropertiesHandler(fakeFigma(node))({
      nodeId: '1:1',
      ...args,
    })) as TextPropertiesResult;

  it('wraps auto-width text at a width and lets its height follow', async () => {
    const node = textBox({ mode: 'WIDTH_AND_HEIGHT' });
    const result = await run(node, { width: 200 });
    expect(node).toMatchObject({ textAutoResize: 'HEIGHT', width: 200, height: 30 });
    expect(result).toEqual({ ok: true, nodeId: '1:1', width: 200, height: 30 });
  });

  it('keeps auto-height text auto height, refitting it to the new width', async () => {
    const node = textBox({ mode: 'HEIGHT', width: 400 });
    await run(node, { width: 100 });
    expect(node).toMatchObject({ textAutoResize: 'HEIGHT', width: 100, height: 60 });
  });

  it('keeps a fixed box fixed, at its height, when only the width changes', async () => {
    const node = textBox({ mode: 'NONE', width: 300, height: 100 });
    await run(node, { width: 150 });
    expect(node).toMatchObject({ textAutoResize: 'NONE', width: 150, height: 100 });
  });

  it('makes a fixed box from width + height, and from height alone at the current width', async () => {
    const both = textBox({ mode: 'WIDTH_AND_HEIGHT' });
    await run(both, { width: 120, height: 80 });
    expect(both).toMatchObject({ textAutoResize: 'NONE', width: 120, height: 80 });

    const tall = textBox({ mode: 'HEIGHT', width: 200 });
    await run(tall, { height: 90 });
    expect(tall).toMatchObject({ textAutoResize: 'NONE', width: 200, height: 90 });
  });

  it('fixes a width-only box at the height its wrapped text needs when NONE is named too', async () => {
    // Not at the 15px it had before being narrowed: four lines at 100px are 60px.
    const node = textBox({ mode: 'WIDTH_AND_HEIGHT' });
    await run(node, { width: 100, textAutoResize: 'NONE' });
    expect(node).toMatchObject({ textAutoResize: 'NONE', width: 100, height: 60 });
  });

  it('keeps a line clamp on text that is only being widened', async () => {
    // A resize that keeps the height keeps auto height and the clamp; a mode write would clear it.
    const node = textBox({ mode: 'HEIGHT', width: 400, textTruncation: 'ENDING', maxLines: 2 });
    await run(node, { width: 50 });
    expect(node).toMatchObject({
      textAutoResize: 'HEIGHT',
      textTruncation: 'ENDING',
      maxLines: 2,
      width: 50,
      height: 30,
    });
  });

  it('keeps the ellipsis when a height fixes a clamped box; the line count goes with auto height', async () => {
    // A fixed box truncates at its own edge, and reads no maxLines (measured).
    const node = textBox({ mode: 'HEIGHT', width: 100, textTruncation: 'ENDING', maxLines: 2 });
    const result = await run(node, { height: 40 });
    expect(node).toMatchObject({ textAutoResize: 'TRUNCATE', maxLines: null, height: 40 });
    expect(result).not.toHaveProperty('adjusted');
  });

  it('keeps the ellipsis when textAutoResize alone fixes a clamped box', async () => {
    const node = textBox({ mode: 'HEIGHT', width: 100, textTruncation: 'ENDING', maxLines: 2 });
    await run(node, { textAutoResize: 'NONE' });
    expect(node).toMatchObject({
      textAutoResize: 'TRUNCATE',
      textTruncation: 'ENDING',
      maxLines: null,
      height: 30,
    });
  });

  it('keeps a line clamp when auto height becomes auto width', async () => {
    const node = textBox({ mode: 'HEIGHT', width: 100, textTruncation: 'ENDING', maxLines: 2 });
    await run(node, { textAutoResize: 'WIDTH_AND_HEIGHT' });
    expect(node).toMatchObject({ textAutoResize: 'WIDTH_AND_HEIGHT', maxLines: 2 });
  });

  it('gives a newly clamped auto-sized text the single line Figma gives it', async () => {
    const node = textBox({ mode: 'HEIGHT', width: 100 });
    await run(node, { textTruncation: 'ENDING' });
    expect(node).toMatchObject({ textTruncation: 'ENDING', maxLines: 1, height: 15 });
  });

  it.each([
    [
      { textTruncation: 'ENDING', maxLines: 2 },
      'NONE',
      { textAutoResize: 'TRUNCATE', height: 40 },
      /maxLines 2 was not applied — a fixed box shows no line count/,
    ],
    [
      { height: 40, textTruncation: 'ENDING', maxLines: 2 },
      'HEIGHT',
      { textAutoResize: 'TRUNCATE', height: 40 },
      /maxLines 2 was not applied — a fixed box/,
    ],
    [
      { maxLines: 2 },
      'HEIGHT',
      { textAutoResize: 'HEIGHT', textTruncation: 'DISABLED' },
      /maxLines 2 was not applied — it needs textTruncation ENDING/,
    ],
    [
      { textTruncation: 'DISABLED', maxLines: 2 },
      'HEIGHT',
      { textAutoResize: 'HEIGHT', textTruncation: 'DISABLED' },
      /maxLines 2 was not applied — it needs textTruncation ENDING/,
    ],
  ] as const)(
    'applies the rest of %o on %s text and names the maxLines Figma would not show',
    async (args, mode, box, message) => {
      // Figma drops such a maxLines without an error, and it never shows up later (measured), so
      // it is left out — but the call goes on as it always did, with the rest of its fields.
      const node = textBox({ mode, width: 100, height: 40 });
      const result = await run(node, { ...args, fontSize: 20 });
      expect(node).toMatchObject({ ...box, fontSize: 20, maxLines: null });
      expect(result.adjusted).toMatch(message);
      // Left out of the box, not written and then reported back as Figma's refusal.
      expect(result.adjusted).not.toMatch(/did not apply what was asked/);
    },
  );

  it('turns the ellipsis on for TRUNCATE, and lets a truncation named in the call win', async () => {
    const truncate = textBox({ mode: 'HEIGHT', width: 100 });
    await run(truncate, { textAutoResize: 'TRUNCATE' });
    // Fixed at the four lines it showed, not the one line Figma clamps newly ellipsised text to.
    expect(truncate).toMatchObject({
      textAutoResize: 'TRUNCATE',
      textTruncation: 'ENDING',
      height: 60,
    });

    const off = textBox({ mode: 'HEIGHT', width: 100, textTruncation: 'ENDING', maxLines: 2 });
    await run(off, { width: 200, textTruncation: 'DISABLED', maxLines: null });
    expect(off).toMatchObject({
      textAutoResize: 'HEIGHT',
      textTruncation: 'DISABLED',
      maxLines: null,
    });
  });

  it('clears the line count a resize carried onto a fixed box, keeping the ellipsis', async () => {
    // Fixing a clamped box carries its maxLines over until the next resize (measured); a fixed
    // box written here ends without one, as it would after any later resize.
    const node = textBox({ mode: 'HEIGHT', width: 100, textTruncation: 'ENDING', maxLines: 2 });
    node.resize(100, 50);
    expect(node).toMatchObject({ textAutoResize: 'TRUNCATE', maxLines: 2 });
    await run(node, { textTruncation: 'ENDING' });
    expect(node).toMatchObject({ textAutoResize: 'TRUNCATE', maxLines: null, height: 50 });
  });

  it('leaves a vertically centred box where it was, however its box is rewritten', async () => {
    // Auto height re-fits a CENTER box around its middle; a mode change and a fixed box measured
    // for its text both pass through it.
    const switched = textBox({ mode: 'NONE', width: 200, height: 80, textAlignVertical: 'CENTER' });
    await run(switched, { textAutoResize: 'HEIGHT' });
    expect(switched).toMatchObject({ x: 10, y: 20, width: 200, height: 30 });

    const measured = textBox({ mode: 'NONE', width: 200, height: 80, textAlignVertical: 'CENTER' });
    await run(measured, { width: 100, textAutoResize: 'NONE' });
    expect(measured).toMatchObject({ x: 10, y: 20, width: 100, height: 60 });
  });

  it('fixes auto-height text at the size it has, which a same-size resize does not', async () => {
    const plain = textBox({ mode: 'HEIGHT', width: 100 });
    const result = await run(plain, { textAutoResize: 'NONE' });
    expect(plain).toMatchObject({ textAutoResize: 'NONE', width: 100, height: 60 });
    expect(result).not.toHaveProperty('adjusted');

    const pinned = textBox({ mode: 'HEIGHT', width: 100, textTruncation: 'ENDING', maxLines: 2 });
    Object.assign(pinned, { resize: () => {} });
    await run(pinned, { textAutoResize: 'NONE' });
    // A height no resize can move is fixed by writing the mode, and the ellipsis written back.
    expect(pinned).toMatchObject({ textAutoResize: 'TRUNCATE', maxLines: null });
  });

  it('reports a box Figma did not bring to what was asked', async () => {
    const node = textBox({ mode: 'HEIGHT', width: 100, textTruncation: 'ENDING', maxLines: 1 });
    Object.defineProperty(node, 'maxLines', { get: () => 1, set: () => {} });
    const result = await run(node, { maxLines: 3 });
    expect(result.adjusted).toBe(
      'the box ended with maxLines 1 — Figma did not apply what was asked',
    );
  });

  it('keeps a fixed box at its height when NONE is named without a size', async () => {
    const node = textBox({ mode: 'NONE', width: 200, height: 80 });
    await run(node, { textAutoResize: 'NONE' });
    expect(node).toMatchObject({ textAutoResize: 'NONE', width: 200, height: 80 });
  });

  it('refuses a size an instance ignores, before writing anything else', async () => {
    // Figma ignored the resize of a label inside an instance, and the auto-height write that
    // followed still landed — leaving the label FIXED, no longer hugging its text (measured).
    const node = textBox({ mode: 'WIDTH_AND_HEIGHT' });
    Object.assign(node, {
      parent: { type: 'INSTANCE', id: '9:9', name: 'Button', parent: null },
      resize: () => {},
    });
    await expect(run(node, { width: 30, fontSize: 20 })).rejects.toThrow(
      /1:1 cannot take this box change.* it sits inside instance 9:9 \("Button"\)/,
    );
    expect(node).toMatchObject({ textAutoResize: 'WIDTH_AND_HEIGHT', width: 400 });
    expect(node).not.toHaveProperty('fontSize');
  });

  it('fixes auto-sized text where it stands inside an instance, by the mode write alone', async () => {
    // At its own width the box already has the height its text shows, so no resize is needed —
    // and the mode write lands inside an instance, where the resize would be ignored (measured).
    const node = textBox({ mode: 'HEIGHT', width: 100, textTruncation: 'ENDING', maxLines: 2 });
    Object.assign(node, {
      parent: { type: 'INSTANCE', id: '9:9', name: 'Card', parent: null },
      resize: () => {},
    });
    const result = await run(node, { textAutoResize: 'NONE' });
    expect(node).toMatchObject({
      textAutoResize: 'TRUNCATE',
      textTruncation: 'ENDING',
      width: 100,
      height: 30,
    });
    expect(result).not.toHaveProperty('adjusted');
  });

  it('still refuses re-fitting a box at a new width inside an instance', async () => {
    const node = textBox({ mode: 'HEIGHT', width: 100 });
    Object.assign(node, {
      parent: { type: 'INSTANCE', id: '9:9', name: 'Card', parent: null },
      resize: () => {},
    });
    await expect(run(node, { textAutoResize: 'NONE', width: 200 })).rejects.toThrow(
      /needs a resize .* inside instance 9:9/,
    );
    expect(node).toMatchObject({ textAutoResize: 'HEIGHT', width: 100 });
  });

  it('lets a mode change through inside an instance when it needs no resize', async () => {
    const node = textBox({ mode: 'WIDTH_AND_HEIGHT' });
    Object.assign(node, {
      parent: { type: 'INSTANCE', id: '9:9', name: 'Card', parent: null },
      resize: () => {},
    });
    await run(node, { textTruncation: 'ENDING', maxLines: 1 });
    expect(node).toMatchObject({ textAutoResize: 'WIDTH_AND_HEIGHT', maxLines: 1 });
  });

  it('writes the box inside an instance whose content Figma does resize, such as a slot', async () => {
    const node = textBox({ mode: 'NONE', width: 200, height: 80 });
    node.parent = {
      type: 'SLOT',
      parent: { type: 'INSTANCE', id: '9:9', name: 'Card', parent: null },
    } as never;
    await run(node, { width: 150 });
    expect(node).toMatchObject({ textAutoResize: 'NONE', width: 150, height: 80 });
  });

  it('says so when FigJam holds a fixed box at the height of its text', async () => {
    // FigJam kept a fixed text box no shorter than its lines (measured: 20, 30, 31 → 45; 100 kept),
    // so fixing a two-line clamp grows the box to the whole text.
    const floored = (editorType: string) => {
      const node = textBox({ mode: 'HEIGHT', width: 120, textTruncation: 'ENDING', maxLines: 2 });
      const resize = node.resize.bind(node);
      Object.assign(node, {
        resize: (w: number, h: number) => resize(w, Math.max(h, 15 * Math.ceil(400 / w))),
      });
      const ctx = { ...fakeFigma(node), editorType } as unknown as typeof figma;
      return { node, run: createSetTextPropertiesHandler(ctx) };
    };

    const figjam = floored('figjam');
    const result = (await figjam.run({
      nodeId: '1:1',
      textAutoResize: 'NONE',
    })) as TextPropertiesResult;
    expect(figjam.node).toMatchObject({ textAutoResize: 'TRUNCATE', height: 60 });
    expect(result.adjusted).toBe(
      'FigJam keeps a fixed text box at least as tall as its text, so it is 120 × 60, not the 30 ' +
        'asked or shown before',
    );

    const design = floored('figma');
    const plain = (await design.run({
      nodeId: '1:1',
      textAutoResize: 'NONE',
    })) as TextPropertiesResult;
    expect(plain.adjusted).toBe('Figma sized it to 120 × 60 instead');
  });

  it('says why when a min / max bound holds the box from the width asked for', async () => {
    const node = textBox({ mode: 'WIDTH_AND_HEIGHT' });
    const resize = node.resize.bind(node);
    Object.assign(node, {
      maxWidth: 150,
      resize: (w: number, h: number) => resize(Math.min(w, 150), h),
    });
    const result = await run(node, { width: 300 });
    expect(result).toMatchObject({
      width: 150,
      adjusted: 'held by maxWidth 150 — clear or change the bound with set_layout_props first',
    });
    expect(node.textAutoResize).toBe('HEIGHT');
  });

  it('loads the node font before a size-only write', async () => {
    const loadFontAsync = vi.fn<() => Promise<void>>(async () => {});
    await createSetTextPropertiesHandler(fakeFigma(textBox({ mode: 'HEIGHT' }), loadFontAsync))({
      nodeId: '1:1',
      width: 100,
    });
    expect(loadFontAsync).toHaveBeenCalledWith({ family: 'Inter', style: 'Regular' });
  });

  it.each([
    [{ width: 100, textAutoResize: 'WIDTH_AND_HEIGHT' }, /width conflicts with textAutoResize/],
    [{ height: 40, textAutoResize: 'HEIGHT' }, /height conflicts with textAutoResize HEIGHT/],
    [{ width: 100, height: 40, textAutoResize: 'WIDTH_AND_HEIGHT' }, /width and height conflicts/],
    [{ width: 0 }, /width must be a number of at least 0.01/],
    [{ height: Number.NaN }, /height must be a number of at least 0.01/],
    [{ width: '100' }, /width must be a number/],
  ])('refuses %o before writing anything', async (args, message) => {
    const node = textBox({ mode: 'WIDTH_AND_HEIGHT' });
    await expect(run(node, args)).rejects.toThrow(message);
    expect(node).toMatchObject({ textAutoResize: 'WIDTH_AND_HEIGHT', width: 400, height: 15 });
  });

  it('refuses a size on text set along a path', async () => {
    const node = { id: '1:1', type: 'TEXT_PATH', characters: 'Round', fontName: {} };
    await expect(run(node, { width: 100 })).rejects.toThrow(/no text box to size/);
  });
});

describe('set_text_properties on a mixed-font node', () => {
  it('loads the target face without mutating the frozen range font list', async () => {
    // getRangeAllFontNames hands back a frozen array in Figma's runtime (measured); pushing the
    // target face onto it threw "object is not extensible" for every mixed-font node given a
    // fontName. The live rollback harness is what caught it.
    const loadFontAsync = vi.fn<() => Promise<void>>(async () => {});
    const node = {
      id: '1:1',
      type: 'TEXT',
      characters: 'ab',
      fontName: MIXED as unknown,
      getRangeAllFontNames: () =>
        Object.freeze([
          { family: 'Inter', style: 'Regular' },
          { family: 'Inter', style: 'Bold' },
        ]),
    };
    await createSetTextPropertiesHandler(fakeFigma(node, loadFontAsync))({
      nodeId: '1:1',
      fontName: { family: 'Inter', style: 'Medium' },
    });
    expect(node.fontName).toEqual({ family: 'Inter', style: 'Medium' });
    expect(loadFontAsync).toHaveBeenCalledWith({ family: 'Inter', style: 'Bold' });
    expect(loadFontAsync).toHaveBeenCalledWith({ family: 'Inter', style: 'Medium' });
  });

  it('sets horizontal and vertical text alignment, loading the font first', async () => {
    const loadFontAsync = vi.fn<() => Promise<void>>(async () => {});
    const node = {
      id: '1:1',
      type: 'TEXT',
      characters: 'hi',
      fontName: { family: 'Inter', style: 'Regular' },
      textAlignHorizontal: 'LEFT',
      textAlignVertical: 'TOP',
    };
    const result = (await createSetTextPropertiesHandler(fakeFigma(node, loadFontAsync))({
      nodeId: '1:1',
      textAlignHorizontal: 'CENTER',
      textAlignVertical: 'BOTTOM',
    })) as MutateResult;

    expect(node).toMatchObject({ textAlignHorizontal: 'CENTER', textAlignVertical: 'BOTTOM' });
    expect(loadFontAsync).toHaveBeenCalledWith({ family: 'Inter', style: 'Regular' });
    expect(result).toEqual({ ok: true, nodeId: '1:1' });
  });

  it('leaves alignment alone when it is not passed, and rejects a non-string value', async () => {
    const node = {
      id: '1:1',
      type: 'TEXT',
      characters: 'hi',
      fontName: { family: 'Inter', style: 'Regular' },
      textAlignHorizontal: 'RIGHT',
      textAlignVertical: 'CENTER',
    };
    await createSetTextPropertiesHandler(fakeFigma(node))({ nodeId: '1:1', fontSize: 14 });
    expect(node).toMatchObject({ textAlignHorizontal: 'RIGHT', textAlignVertical: 'CENTER' });
    await expect(
      createSetTextPropertiesHandler(fakeFigma(node))({ nodeId: '1:1', textAlignHorizontal: 1 }),
    ).rejects.toThrow(/textAlignHorizontal must be a string/);
  });
});

describe('set_text_properties on text set along a path', () => {
  it('sets the typography and the two alignments a path has', async () => {
    const node = {
      id: '1:1',
      type: 'TEXT_PATH',
      characters: 'Round',
      fontName: { family: 'Inter', style: 'Regular' },
    };
    await createSetTextPropertiesHandler(fakeFigma(node))({
      nodeId: '1:1',
      fontSize: 18,
      letterSpacing: { unit: 'PERCENT', value: 8 },
      textAlignHorizontal: 'CENTER',
      textAlignVertical: 'BOTTOM',
    });
    expect(node).toMatchObject({
      fontSize: 18,
      letterSpacing: { unit: 'PERCENT', value: 8 },
      textAlignHorizontal: 'CENTER',
      textAlignVertical: 'BOTTOM',
    });
  });

  it('refuses the line, box and decoration fields a path lacks — all of them, before writing', async () => {
    const node: Record<string, unknown> = {
      id: '1:1',
      type: 'TEXT_PATH',
      characters: 'Round',
      fontName: { family: 'Inter', style: 'Regular' },
    };
    await expect(
      createSetTextPropertiesHandler(fakeFigma(node))({
        nodeId: '1:1',
        fontSize: 18,
        lineHeight: { unit: 'AUTO' },
        textDecoration: 'UNDERLINE',
        maxLines: 2,
      }),
    ).rejects.toThrow('is text on a path, which has no lineHeight, textDecoration, maxLines');
    expect(node).not.toHaveProperty('fontSize');
  });
});
