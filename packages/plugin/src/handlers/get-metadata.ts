import type { GetMetadataResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

export const createGetMetadataHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  () => {
    const root = figmaCtx.root;
    const result: GetMetadataResult = {
      fileName: root.name,
      currentPage: { id: figmaCtx.currentPage.id, name: figmaCtx.currentPage.name },
      pages: root.children.map(p => ({ id: p.id, name: p.name })),
    };
    return result;
  };
