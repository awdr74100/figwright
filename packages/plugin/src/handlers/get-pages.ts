import type { GetPagesResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

/**
 * Every page's id and name, plus its prototype flows.
 *
 * The flows ride along here rather than in a tool of their own because reading them is free: a
 * page's `flowStartingPoints` is readable while the page is still unloaded under `documentAccess:
 * "dynamic-page"` (measured — its `children` throws on the same page at the same moment), so this
 * call still loads nothing.
 */
export const createGetPagesHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  () => {
    const result: GetPagesResult = {
      pages: figmaCtx.root.children.map(p => ({
        id: p.id,
        name: p.name,
        flows: p.flowStartingPoints.map(f => ({ nodeId: f.nodeId, name: f.name })),
      })),
    };
    return result;
  };
