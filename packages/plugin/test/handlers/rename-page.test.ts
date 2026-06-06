import type { MutateResult } from '@figma-mcp-relay/shared';
import { describe, expect, it } from 'vitest';

import { createRenamePageHandler } from '../../src/handlers/rename-page.js';

const fakeFigma = (page: unknown): typeof figma =>
  ({ getNodeByIdAsync: async () => page }) as unknown as typeof figma;

describe('rename_page handler', () => {
  it('renames a page', async () => {
    const page = { id: 'P:1', type: 'PAGE', name: 'old' };
    const result = (await createRenamePageHandler(fakeFigma(page))({
      pageId: 'P:1',
      name: 'Components',
    })) as MutateResult;
    expect(page.name).toBe('Components');
    expect(result).toEqual({ ok: true, nodeId: 'P:1' });
  });

  it('throws on missing page or bad input', async () => {
    await expect(
      createRenamePageHandler(fakeFigma(null))({ pageId: 'P:9', name: 'x' }),
    ).rejects.toThrow(/not found/);
    await expect(createRenamePageHandler(fakeFigma(null))({ pageId: 'P:1' })).rejects.toThrow(
      /name/,
    );
    await expect(createRenamePageHandler(fakeFigma(null))({ name: 'x' })).rejects.toThrow(/pageId/);
  });
});
