import type { MutateResult } from '@figma-mcp-relay/shared';
import { describe, expect, it, vi } from 'vitest';

import { createSetTextHandler } from '../../src/handlers/set-text.js';

const MIXED = Symbol('figma.mixed');

const fakeFigma = (
  lookup: Record<string, unknown>,
  loadFontAsync = vi.fn<() => Promise<void>>(async () => {}),
): typeof figma =>
  ({
    mixed: MIXED,
    loadFontAsync,
    getNodeByIdAsync: async (id: string) => lookup[id] ?? null,
  }) as unknown as typeof figma;

describe('set_text handler', () => {
  it('loads the font then replaces characters', async () => {
    const node = {
      id: '1:1',
      type: 'TEXT',
      fontName: { family: 'Inter', style: 'Regular' },
      characters: 'old',
    };
    const loadFontAsync = vi.fn<() => Promise<void>>(async () => {});
    const handler = createSetTextHandler(fakeFigma({ '1:1': node }, loadFontAsync));
    const result = (await handler({ nodeId: '1:1', characters: 'new' })) as MutateResult;

    expect(loadFontAsync).toHaveBeenCalledWith({ family: 'Inter', style: 'Regular' });
    expect(node.characters).toBe('new');
    expect(result).toEqual({ ok: true, nodeId: '1:1' });
  });

  it('loads every font for mixed-font text before mutating', async () => {
    const fonts = [
      { family: 'Inter', style: 'Regular' },
      { family: 'Inter', style: 'Bold' },
    ];
    const node = {
      id: '1:2',
      type: 'TEXT',
      fontName: MIXED,
      characters: 'ab',
      getRangeAllFontNames: () => fonts,
    };
    const loadFontAsync = vi.fn<() => Promise<void>>(async () => {});
    const handler = createSetTextHandler(fakeFigma({ '1:2': node }, loadFontAsync));
    await handler({ nodeId: '1:2', characters: 'cd' });

    expect(loadFontAsync).toHaveBeenCalledTimes(2);
    expect(node.characters).toBe('cd');
  });

  it('throws for non-TEXT nodes and bad input', async () => {
    const handler = createSetTextHandler(
      fakeFigma({ '1:1': { id: '1:1', type: 'RECTANGLE' } }),
    );
    await expect(handler({ nodeId: '1:1', characters: 'x' })).rejects.toThrow(/TEXT/);
    await expect(handler({ nodeId: '1:1' })).rejects.toThrow(/characters/);
  });
});
