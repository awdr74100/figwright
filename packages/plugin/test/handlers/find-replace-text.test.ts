import type { BatchNodeResult } from '@figma-mcp-relay/shared';
import { describe, expect, it, vi } from 'vitest';

import { createFindReplaceTextHandler } from '../../src/handlers/find-replace-text.js';

const makeTextNode = (id: string, characters: string): TextNode =>
  ({ id, characters, fontName: { family: 'Inter', style: 'Regular' } }) as unknown as TextNode;

const makeFigma = (nodes: TextNode[]): typeof figma =>
  ({
    mixed: Symbol('mixed'),
    currentPage: { findAllWithCriteria: () => nodes },
    loadFontAsync: vi.fn<() => Promise<void>>(async () => {}),
  }) as unknown as typeof figma;

describe('find_replace_text handler', () => {
  it('replaces all occurrences in matching text nodes (case-insensitive by default)', async () => {
    const hit = makeTextNode('1:1', 'Hello hello HELLO');
    const miss = makeTextNode('1:2', 'nothing here');
    const handler = createFindReplaceTextHandler(makeFigma([hit, miss]));
    const result = (await handler({ find: 'hello', replace: 'hi' })) as BatchNodeResult;

    expect(hit.characters).toBe('hi hi hi');
    expect(result).toEqual({ ok: true, affected: ['1:1'] });
  });

  it('respects caseSensitive', async () => {
    const node = makeTextNode('1:1', 'Hello hello');
    const handler = createFindReplaceTextHandler(makeFigma([node]));
    await handler({ find: 'hello', replace: 'hi', caseSensitive: true });
    expect(node.characters).toBe('Hello hi');
  });

  it('throws on empty find or non-string replace', async () => {
    const handler = createFindReplaceTextHandler(makeFigma([]));
    await expect(handler({ find: '', replace: 'x' })).rejects.toThrow(/find/);
    await expect(handler({ find: 'a', replace: 1 })).rejects.toThrow(/replace/);
  });
});
