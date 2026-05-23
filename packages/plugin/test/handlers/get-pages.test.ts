import type { GetPagesResult } from '@figma-mcp-relay/shared';
import { describe, expect, it } from 'vitest';

import { createGetPagesHandler } from '../../src/handlers/get-pages.js';

const fakeFigma = (pages: { id: string; name: string }[]): typeof figma =>
  ({
    root: { children: pages },
  }) as unknown as typeof figma;

describe('get_pages handler', () => {
  it('returns id+name pairs in order', async () => {
    const handler = createGetPagesHandler(
      fakeFigma([
        { id: 'p-1', name: 'Cover' },
        { id: 'p-2', name: 'Details' },
      ]),
    );
    const result = (await handler(undefined)) as GetPagesResult;
    expect(result).toEqual({
      pages: [
        { id: 'p-1', name: 'Cover' },
        { id: 'p-2', name: 'Details' },
      ],
    });
  });

  it('returns empty when no pages', async () => {
    const handler = createGetPagesHandler(fakeFigma([]));
    const result = (await handler(undefined)) as GetPagesResult;
    expect(result.pages).toEqual([]);
  });
});
