import { type GetDocumentResult, TOOL_RESULT_BUDGET_BYTES } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { serializeTrees, treeTooLargeError } from '../serializer.js';

export const createGetDocumentHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async () => {
    const page = figmaCtx.currentPage;
    const run = await serializeTrees(page.children, TOOL_RESULT_BUDGET_BYTES);
    if (!run.complete) throw treeTooLargeError('get_document', run.total, 'page');
    const result: GetDocumentResult = {
      pageId: page.id,
      pageName: page.name,
      children: run.nodes,
    };
    return result;
  };
