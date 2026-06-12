import type { ListFilesResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

export const createListFilesHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async () => {
    const result: ListFilesResult = {
      files: [
        {
          fileKey: figmaCtx.fileKey ?? null,
          fileName: figmaCtx.root.name,
          currentPage: { id: figmaCtx.currentPage.id, name: figmaCtx.currentPage.name },
        },
      ],
    };
    return result;
  };
