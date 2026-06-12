import type { GetSelectionResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { serializeSceneNode } from '../serializer.js';

export const createGetSelectionHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async () => {
    const page = figmaCtx.currentPage;
    const result: GetSelectionResult = {
      pageId: page.id,
      pageName: page.name,
      nodes: await Promise.all(page.selection.map(serializeSceneNode)),
    };
    return result;
  };
