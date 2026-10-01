import type { MutateResult } from '@figwright/shared';
import { describe, expect, it, vi } from 'vitest';

import { createSetTextHandler } from '../../src/handlers/set-text.js';
import { makeText } from './text-fake.js';

const MIXED = Symbol('figma.mixed');

const fakeFigma = (
  lookup: Record<string, unknown>,
  fonts: { loaded: boolean } = { loaded: false },
  loadFontAsync = vi.fn<() => Promise<void>>(async () => {
    fonts.loaded = true;
  }),
): typeof figma =>
  ({
    mixed: MIXED,
    loadFontAsync,
    getNodeByIdAsync: async (id: string) => lookup[id] ?? null,
  }) as unknown as typeof figma;

/** Run set_text on a node laid out as `runs`, and return its runs afterwards. */
const edit = async (runs: [string, string][], characters: string) => {
  const fonts = { loaded: false };
  const node = makeText('1:1', runs, fonts);
  await createSetTextHandler(fakeFigma({ '1:1': node }, fonts))({ nodeId: '1:1', characters });
  return node;
};

describe('set_text handler', () => {
  it('loads the font then replaces characters', async () => {
    const fonts = { loaded: false };
    const node = makeText('1:1', [['old', 'plain']], fonts);
    const loadFontAsync = vi.fn<() => Promise<void>>(async () => {
      fonts.loaded = true;
    });
    const handler = createSetTextHandler(fakeFigma({ '1:1': node }, fonts, loadFontAsync));
    const result = (await handler({ nodeId: '1:1', characters: 'new' })) as MutateResult;

    expect(loadFontAsync).toHaveBeenCalledWith({ family: 'Inter', style: 'Regular' });
    expect(node.characters).toBe('new');
    expect(result).toEqual({ ok: true, nodeId: '1:1' });
  });

  it('loads every font for mixed-font text before mutating', async () => {
    const fonts = { loaded: false };
    const node = Object.assign(makeText('1:2', [['ab', 'plain']], fonts), {
      fontName: MIXED,
      getRangeAllFontNames: () => [
        { family: 'Inter', style: 'Regular' },
        { family: 'Inter', style: 'Bold' },
      ],
    });
    const loadFontAsync = vi.fn<() => Promise<void>>(async () => {
      fonts.loaded = true;
    });
    const handler = createSetTextHandler(fakeFigma({ '1:2': node }, fonts, loadFontAsync));
    await handler({ nodeId: '1:2', characters: 'cd' });

    expect(loadFontAsync).toHaveBeenCalledTimes(2);
    expect(node.characters).toBe('cd');
  });

  // Measured: assigning `characters` restyled the whole node. A typo fix must leave the runs it
  // does not touch — here the smaller "/mo" after a price.
  it('keeps the styling of the text the old and new strings share', async () => {
    const node = await edit(
      [
        ['$10', 'price'],
        ['/mo', 'small'],
      ],
      '$12/mo',
    );
    expect(node.runs()).toEqual([
      ['$12', 'price'],
      ['/mo', 'small'],
    ]);
  });

  it('keeps a styled word in the middle when only the end changes', async () => {
    const node = await edit(
      [
        ['Hello ', 'regular'],
        ['bold', 'bold-red'],
        [' world', 'regular'],
      ],
      'Hello bold earth',
    );
    expect(node.runs()).toEqual([
      ['Hello ', 'regular'],
      ['bold', 'bold-red'],
      [' earth', 'regular'],
    ]);
  });

  it('gives text inserted with nothing replaced the style of the character before it', async () => {
    const node = await edit(
      [
        ['Hello', 'bold'],
        [' world', 'regular'],
      ],
      'Hello!! world',
    );
    expect(node.runs()).toEqual([
      ['Hello!!', 'bold'],
      [' world', 'regular'],
    ]);
  });

  // Nothing in common: the same as assigning `characters` — one run in the first character's style.
  it('restyles to the first character when nothing is shared, as before', async () => {
    const node = await edit(
      [
        ['abc', 'one'],
        ['def', 'two'],
      ],
      'xyz',
    );
    expect(node.runs()).toEqual([['xyz', 'one']]);
  });

  it('fills an empty node', async () => {
    const node = await edit([], 'Hi');
    expect(node.characters).toBe('Hi');
  });

  // "Hello World" with a bold "World", rewritten as "Changed": the strings share only the final
  // "d". Keeping it would leave one bold letter at the end of a plain word — worse than the old
  // whole-node rewrite. A shared edge that cuts into a run backs off to the run's boundary.
  it('keeps no part of a run the edit cuts into, so nothing is left styled on its own', async () => {
    const node = await edit(
      [
        ['Hello ', 'regular'],
        ['World', 'bold'],
      ],
      'Changed',
    );
    expect(node.runs()).toEqual([['Changed', 'regular']]);
  });

  it('fixes a typo inside a run and keeps every other run whole', async () => {
    const node = await edit(
      [
        ['Read the ', 'regular'],
        ['documantation', 'link'],
        [' today', 'regular'],
      ],
      'Read the documentation today',
    );
    expect(node.runs()).toEqual([
      ['Read the ', 'regular'],
      ['documentation', 'link'],
      [' today', 'regular'],
    ]);
  });

  // The old and new emoji share the high half of their surrogate pair, so a shared prefix counted
  // in UTF-16 units ends mid-pair. Backing off to the run boundary hands Figma the whole character.
  it('replaces an emoji whole, never half of its surrogate pair', async () => {
    const fonts = { loaded: false };
    const node = makeText(
      '1:1',
      [
        ['👍', 'emoji'],
        [' ok', 'plain'],
      ],
      fonts,
    );
    const inserted: string[] = [];
    const deleted: [number, number][] = [];
    const insert = node.insertCharacters.bind(node);
    const remove = node.deleteCharacters.bind(node);
    node.insertCharacters = (start, text, useStyle) => {
      inserted.push(text);
      insert(start, text, useStyle);
    };
    node.deleteCharacters = (start, end) => {
      deleted.push([start, end]);
      remove(start, end);
    };
    await createSetTextHandler(fakeFigma({ '1:1': node }, fonts))({
      nodeId: '1:1',
      characters: '👎 ok',
    });

    expect(node.runs()).toEqual([
      ['👎', 'emoji'],
      [' ok', 'plain'],
    ]);
    expect(inserted).toEqual(['👎']);
    expect(deleted).toEqual([[2, 4]]);
  });

  it('throws for non-TEXT nodes and bad input', async () => {
    const handler = createSetTextHandler(fakeFigma({ '1:1': { id: '1:1', type: 'RECTANGLE' } }));
    await expect(handler({ nodeId: '1:1', characters: 'x' })).rejects.toThrow(/TEXT/);
    await expect(handler({ nodeId: '1:1' })).rejects.toThrow(/characters/);
  });
});
