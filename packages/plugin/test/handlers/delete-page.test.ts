import type { MutateResult } from '@figwright/shared';
import { describe, expect, it, vi } from 'vitest';

import { createDeletePageHandler } from '../../src/handlers/delete-page.js';

const fakeFigma = (page: unknown, currentPageId: string, pageCount: number): typeof figma =>
  ({
    getNodeByIdAsync: async () => page,
    currentPage: { id: currentPageId },
    root: { children: Array.from({ length: pageCount }, (_, i) => ({ id: `P:${i}` })) },
  }) as unknown as typeof figma;

describe('delete_page handler', () => {
  it('removes a non-current page', async () => {
    const remove = vi.fn<() => void>();
    const page = { id: 'P:2', type: 'PAGE', remove };
    const result = (await createDeletePageHandler(fakeFigma(page, 'P:0', 3))({
      pageId: 'P:2',
    })) as MutateResult;
    expect(remove).toHaveBeenCalledOnce();
    expect(result).toEqual({ ok: true, nodeId: 'P:2' });
  });

  it('refuses to delete the current page or the last page', async () => {
    const current = { id: 'P:0', type: 'PAGE', remove: vi.fn<() => void>() };
    await expect(
      createDeletePageHandler(fakeFigma(current, 'P:0', 3))({ pageId: 'P:0' }),
    ).rejects.toThrow(/current page/);
    const only = { id: 'P:0', type: 'PAGE', remove: vi.fn<() => void>() };
    await expect(
      createDeletePageHandler(fakeFigma(only, 'P:9', 1))({ pageId: 'P:0' }),
    ).rejects.toThrow(/last remaining/);
  });

  it('throws on missing page or bad input', async () => {
    await expect(
      createDeletePageHandler(fakeFigma(null, 'P:0', 3))({ pageId: 'P:9' }),
    ).rejects.toThrow(/not found/);
    await expect(createDeletePageHandler(fakeFigma(null, 'P:0', 3))({})).rejects.toThrow(/pageId/);
  });
});
