import type { MutateResult } from '@figwright/shared';
import { describe, expect, it, vi } from 'vitest';

import { createNavigateToPageHandler } from '../../src/handlers/navigate-to-page.js';

describe('navigate_to_page handler', () => {
  it('switches the active page via setCurrentPageAsync', async () => {
    const page = { id: 'P:2', type: 'PAGE' };
    const setCurrentPageAsync = vi.fn<() => Promise<void>>(async () => {});
    const f = {
      getNodeByIdAsync: async () => page,
      setCurrentPageAsync,
    } as unknown as typeof figma;

    const result = (await createNavigateToPageHandler(f)({ pageId: 'P:2' })) as MutateResult;
    expect(setCurrentPageAsync).toHaveBeenCalledWith(page);
    expect(result).toEqual({ ok: true, nodeId: 'P:2' });
  });

  it('throws on missing page or bad input', async () => {
    const f = {
      getNodeByIdAsync: async () => null,
      setCurrentPageAsync: vi.fn<() => Promise<void>>(async () => {}),
    } as unknown as typeof figma;
    await expect(createNavigateToPageHandler(f)({ pageId: 'P:9' })).rejects.toThrow(/not found/);
    await expect(createNavigateToPageHandler(f)({})).rejects.toThrow(/pageId/);
  });
});
