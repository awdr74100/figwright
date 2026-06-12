import type { MutateResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

/** Switch the active page. Uses setCurrentPageAsync (required under dynamic-page document access). */
export const createNavigateToPageHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { pageId?: unknown };
    if (typeof p.pageId !== 'string')
      throw new TypeError('navigate_to_page: pageId must be a string');

    const node = await figmaCtx.getNodeByIdAsync(p.pageId);
    if (node === null || node.type !== 'PAGE') {
      throw new Error(`navigate_to_page: page ${p.pageId} not found`);
    }
    await figmaCtx.setCurrentPageAsync(node as PageNode);

    const result: MutateResult = { ok: true, nodeId: node.id };
    return result;
  };
