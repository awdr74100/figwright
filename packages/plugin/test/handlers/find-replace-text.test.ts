import type { BatchNodeResult } from '@figwright/shared';
import { describe, expect, it, vi } from 'vitest';

import { createFindReplaceTextHandler } from '../../src/handlers/find-replace-text.js';
import { type FakeText, makeText } from './text-fake.js';

const makeFigma = (nodes: FakeText[], fonts: { loaded: boolean }): typeof figma =>
  ({
    mixed: Symbol('mixed'),
    currentPage: { findAllWithCriteria: () => nodes },
    loadFontAsync: vi.fn<() => Promise<void>>(async () => {
      fonts.loaded = true;
    }),
  }) as unknown as typeof figma;

const setup = (...nodes: [string, [string, string][]][]) => {
  const fonts = { loaded: false };
  const texts = nodes.map(([id, runs]) => makeText(id, runs, fonts));
  return { texts, handler: createFindReplaceTextHandler(makeFigma(texts, fonts)) };
};

describe('find_replace_text handler', () => {
  it('replaces all occurrences in matching text nodes (case-insensitive by default)', async () => {
    const {
      texts: [hit, miss],
      handler,
    } = setup(['1:1', [['Hello hello HELLO', 'plain']]], ['1:2', [['nothing here', 'plain']]]);
    const result = (await handler({ find: 'hello', replace: 'hi' })) as BatchNodeResult;

    expect(hit!.characters).toBe('hi hi hi');
    expect(miss!.characters).toBe('nothing here');
    expect(result).toEqual({ ok: true, affected: ['1:1'] });
  });

  it('respects caseSensitive', async () => {
    const {
      texts: [node],
      handler,
    } = setup(['1:1', [['Hello hello', 'plain']]]);
    await handler({ find: 'hello', replace: 'hi', caseSensitive: true });
    expect(node!.characters).toBe('Hello hi');
  });

  // Measured: assigning `characters` restyled the whole node, so replacing one word wiped a bold
  // red run elsewhere in it. Only the matched text may change.
  it('leaves the styling of text it does not replace as it was', async () => {
    const {
      texts: [node],
      handler,
    } = setup([
      '1:1',
      [
        ['Hello ', 'regular'],
        ['bold', 'bold-red'],
        [' world', 'regular'],
      ],
    ]);
    await handler({ find: 'world', replace: 'earth' });

    expect(node!.runs()).toEqual([
      ['Hello ', 'regular'],
      ['bold', 'bold-red'],
      [' earth', 'regular'],
    ]);
  });

  it('gives each replacement the style of the text it replaced, at every occurrence', async () => {
    const {
      texts: [node],
      handler,
    } = setup([
      '1:1',
      [
        ['Save ', 'regular'],
        ['$10', 'price'],
        [' now, was ', 'regular'],
        ['$10', 'strike'],
      ],
    ]);
    await handler({ find: '$10', replace: '$12.50' });

    expect(node!.runs()).toEqual([
      ['Save ', 'regular'],
      ['$12.50', 'price'],
      [' now, was ', 'regular'],
      ['$12.50', 'strike'],
    ]);
  });

  it('removes a match outright when the replacement is empty', async () => {
    const {
      texts: [node],
      handler,
    } = setup([
      '1:1',
      [
        ['Price ', 'regular'],
        ['(beta)', 'tag'],
        [' today', 'bold'],
      ],
    ]);
    await handler({ find: '(beta)', replace: '' });

    expect(node!.runs()).toEqual([
      ['Price ', 'regular'],
      [' today', 'bold'],
    ]);
  });

  it('throws on empty find or non-string replace', async () => {
    const { handler } = setup();
    await expect(handler({ find: '', replace: 'x' })).rejects.toThrow(/find/);
    await expect(handler({ find: 'a', replace: 1 })).rejects.toThrow(/replace/);
  });
});
