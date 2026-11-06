import type { CreateResult, CreateTextResult } from '@figwright/shared';
import { describe, expect, it, vi } from 'vitest';

import { createCreateTextHandler } from '../../src/handlers/create-text.js';

const makeText = () => ({
  id: '2:1',
  name: 'Text',
  parent: null,
  type: 'TEXT',
  fontName: { family: 'Inter', style: 'Regular' },
  characters: '',
  fontSize: 12,
  x: 0,
  y: 0,
  width: 40,
  height: 15,
  textAutoResize: 'WIDTH_AND_HEIGHT',
  textTruncation: 'DISABLED',
  maxLines: null,
  resize(w: number, h: number) {
    Object.assign(this, { width: w, height: h, textAutoResize: 'NONE' });
  },
  remove: vi.fn<() => void>(),
});

const fakeFigma = (
  text: ReturnType<typeof makeText>,
  currentPage: { appendChild: (n: unknown) => void },
  loadFontAsync = vi.fn<() => Promise<void>>(async () => {}),
  lookup: Record<string, unknown> = {},
): typeof figma =>
  ({
    createText: () => text,
    currentPage,
    loadFontAsync,
    getNodeByIdAsync: async (id: string) => lookup[id] ?? null,
  }) as unknown as typeof figma;

describe('create_text handler', () => {
  it('loads the font, sets characters/size, and appends to the page', async () => {
    const text = makeText();
    const currentPage = { appendChild: vi.fn<(n: unknown) => void>() };
    const loadFontAsync = vi.fn<() => Promise<void>>(async () => {});
    const handler = createCreateTextHandler(
      fakeFigma(text, currentPage, loadFontAsync, { '2:1': text }),
    );
    const result = (await handler({ characters: 'Hi', fontSize: 20 })) as CreateResult;

    expect(loadFontAsync).toHaveBeenCalledWith({ family: 'Inter', style: 'Regular' });
    expect(text.characters).toBe('Hi');
    expect(text.fontSize).toBe(20);
    expect(currentPage.appendChild).toHaveBeenCalledWith(text);
    expect(result).toEqual({
      ok: true,
      nodeId: '2:1',
      name: 'Text',
      type: 'TEXT',
      width: 40,
      height: 15,
    });
  });

  it('wraps at a width through set_text_properties, and reports the size it came out at', async () => {
    const text = makeText();
    const handler = createCreateTextHandler(
      fakeFigma(text, { appendChild: vi.fn<(n: unknown) => void>() }, undefined, { '2:1': text }),
    );
    const result = (await handler({ characters: 'Hi', width: 240 })) as CreateTextResult;
    expect(text).toMatchObject({ width: 240, textAutoResize: 'HEIGHT' });
    expect(result).toMatchObject({ width: 240, height: 15 });
  });

  it.each([
    [
      { width: 200, layoutSizingHorizontal: 'FILL' },
      /width conflicts with layoutSizingHorizontal FILL/,
    ],
    [
      { width: 200, layoutSizingHorizontal: 'HUG' },
      /width conflicts with layoutSizingHorizontal HUG/,
    ],
    [{ height: 40, layoutSizingVertical: 'HUG' }, /height conflicts with layoutSizingVertical HUG/],
    [
      { width: 200, textAutoResize: 'WIDTH_AND_HEIGHT' },
      /create_text: width conflicts with textAutoResize WIDTH_AND_HEIGHT/,
    ],
    [{ height: 40, textAutoResize: 'HEIGHT' }, /create_text: height conflicts with textAutoResize/],
    [{ width: -5 }, /create_text: width must be a number of at least 0.01/],
  ])('refuses %o before creating anything', async (args, message) => {
    const createText = vi.fn<() => unknown>();
    const handler = createCreateTextHandler({ createText } as unknown as typeof figma);
    await expect(handler({ characters: 'Hi', ...args })).rejects.toThrow(message);
    expect(createText).not.toHaveBeenCalled();
  });

  it('creates the text and names a maxLines its box would not show, as set_text_properties does', async () => {
    // Figma drops a line count on a fixed box without an error (measured); the text is still made
    // with everything else asked, as it always was, and the result says what was left out.
    const text = makeText();
    const handler = createCreateTextHandler(
      fakeFigma(text, { appendChild: vi.fn<(n: unknown) => void>() }, undefined, { '2:1': text }),
    );
    const result = (await handler({
      characters: 'Hi',
      fontSize: 20,
      textAutoResize: 'TRUNCATE',
      maxLines: 2,
    })) as CreateTextResult;
    expect(text).toMatchObject({ fontSize: 20, textAutoResize: 'NONE', textTruncation: 'ENDING' });
    expect(text.remove).not.toHaveBeenCalled();
    expect(result.adjusted).toMatch(/maxLines 2 was not applied — a fixed box shows no line count/);
  });

  it('throws when characters is missing', async () => {
    const handler = createCreateTextHandler(
      fakeFigma(makeText(), { appendChild: vi.fn<(n: unknown) => void>() }),
    );
    await expect(handler({})).rejects.toThrow(/characters/);
  });
});
