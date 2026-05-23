import type { GetDocumentResult } from '@figma-mcp-relay/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { serializeTree } from '../serializer.js';

export const createGetDocumentHandler = (figmaCtx: typeof figma): SandboxToolHandler => async () => {
  const page = figmaCtx.currentPage;
  const result: GetDocumentResult = {
    pageId: page.id,
    pageName: page.name,
    children: await Promise.all(page.children.map(serializeTree)),
  };
  return result;
};
