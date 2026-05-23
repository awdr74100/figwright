import type { ListFilesResult } from '@figma-mcp-relay/shared';
import { describe, expect, it } from 'vitest';

import { createListFilesHandler } from '../../src/handlers/list-files.js';

const fakeFigma = (over: { fileKey?: string }): typeof figma =>
  ({
    fileKey: over.fileKey,
    root: { name: 'Mockups.fig' },
    currentPage: { id: 'p-1', name: 'Cover' },
  }) as unknown as typeof figma;

describe('list_files handler', () => {
  it('returns the current file with its key and page', async () => {
    const result = (await createListFilesHandler(fakeFigma({ fileKey: 'abc123' }))(undefined)) as ListFilesResult;
    expect(result).toEqual({
      files: [{ fileKey: 'abc123', fileName: 'Mockups.fig', currentPage: { id: 'p-1', name: 'Cover' } }],
    });
  });

  it('maps an undefined fileKey to null', async () => {
    const result = (await createListFilesHandler(fakeFigma({}))(undefined)) as ListFilesResult;
    expect(result.files[0]?.fileKey).toBeNull();
  });
});
