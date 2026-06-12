import type { CreateResult } from '@figwright/shared';
import { describe, expect, it, vi } from 'vitest';

import { createCreateTextHandler } from '../../src/handlers/create-text.js';

const makeText = () => ({
  id: '2:1',
  name: 'Text',
  type: 'TEXT',
  fontName: { family: 'Inter', style: 'Regular' },
  characters: '',
  fontSize: 12,
  x: 0,
  y: 0,
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
    const handler = createCreateTextHandler(fakeFigma(text, currentPage, loadFontAsync));
    const result = (await handler({ characters: 'Hi', fontSize: 20 })) as CreateResult;

    expect(loadFontAsync).toHaveBeenCalledWith({ family: 'Inter', style: 'Regular' });
    expect(text.characters).toBe('Hi');
    expect(text.fontSize).toBe(20);
    expect(currentPage.appendChild).toHaveBeenCalledWith(text);
    expect(result).toEqual({ ok: true, nodeId: '2:1', name: 'Text', type: 'TEXT' });
  });

  it('throws when characters is missing', async () => {
    const handler = createCreateTextHandler(
      fakeFigma(makeText(), { appendChild: vi.fn<(n: unknown) => void>() }),
    );
    await expect(handler({})).rejects.toThrow(/characters/);
  });
});
