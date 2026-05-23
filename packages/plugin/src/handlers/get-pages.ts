import type { GetPagesResult } from '@figma-mcp-relay/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

export const createGetPagesHandler = (figmaCtx: typeof figma): SandboxToolHandler => () => {
  const result: GetPagesResult = {
    pages: figmaCtx.root.children.map(p => ({ id: p.id, name: p.name })),
  };
  return result;
};
