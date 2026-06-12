import type { MutateResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

/** Delete a page by id. The current page and the last remaining page cannot be removed. */
export const createDeletePageHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { pageId?: unknown };
    if (typeof p.pageId !== 'string') throw new TypeError('delete_page: pageId must be a string');

    const node = await figmaCtx.getNodeByIdAsync(p.pageId);
    if (node === null || node.type !== 'PAGE') {
      throw new Error(`delete_page: page ${p.pageId} not found`);
    }
    if (node.id === figmaCtx.currentPage.id) {
      throw new Error('delete_page: cannot delete the current page');
    }
    if (figmaCtx.root.children.length <= 1) {
      throw new Error('delete_page: cannot delete the last remaining page');
    }
    (node as PageNode).remove();

    const result: MutateResult = { ok: true, nodeId: p.pageId };
    return result;
  };
