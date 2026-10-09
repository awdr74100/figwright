import type { GetDocumentResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { resultCharBudget, serializeTrees, treeTooLargeError } from '../serializer.js';

export const createGetDocumentHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async () => {
    const page = figmaCtx.currentPage;
    const run = await serializeTrees(page.children, resultCharBudget());
    if (!run.complete) throw treeTooLargeError('get_document', run.total, 'page');
    const result: GetDocumentResult = {
      pageId: page.id,
      pageName: page.name,
      children: run.nodes,
    };
    return result;
  };
