import type { GetMetadataResult } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import { createGetMetadataHandler } from '../../src/handlers/get-metadata.js';

const fakeFigma = (input: {
  fileName: string;
  currentPageId: string;
  pages: { id: string; name: string }[];
}): typeof figma =>
  ({
    root: {
      name: input.fileName,
      children: input.pages,
    },
    currentPage: input.pages.find(p => p.id === input.currentPageId),
  }) as unknown as typeof figma;

describe('get_metadata handler', () => {
  it('returns fileName + pages + currentPage', async () => {
    const handler = createGetMetadataHandler(
      fakeFigma({
        fileName: 'My Mockups',
        currentPageId: 'p-2',
        pages: [
          { id: 'p-1', name: 'Cover' },
          { id: 'p-2', name: 'Details' },
        ],
      }),
    );
    const result = (await handler(undefined)) as GetMetadataResult;
    expect(result).toEqual({
      fileName: 'My Mockups',
      currentPage: { id: 'p-2', name: 'Details' },
      pages: [
        { id: 'p-1', name: 'Cover' },
        { id: 'p-2', name: 'Details' },
      ],
    });
  });
});
