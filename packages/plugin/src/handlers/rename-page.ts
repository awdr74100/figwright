import type { MutateResult } from '@figma-mcp-relay/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

/** Rename a page by id. */
export const createRenamePageHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { pageId?: unknown; name?: unknown };
    if (typeof p.pageId !== 'string') throw new TypeError('rename_page: pageId must be a string');
    if (typeof p.name !== 'string') throw new TypeError('rename_page: name must be a string');

    const node = await figmaCtx.getNodeByIdAsync(p.pageId);
    if (node === null || node.type !== 'PAGE') {
      throw new Error(`rename_page: page ${p.pageId} not found`);
    }
    node.name = p.name;

    const result: MutateResult = { ok: true, nodeId: node.id };
    return result;
  };
