import type { CreateResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

/** Create a new page (optionally named). Returns the new page's id / name / type. */
export const createAddPageHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  // eslint-disable-next-line @typescript-eslint/require-await
  async params => {
    const p = (params ?? {}) as { name?: unknown };
    const page = figmaCtx.createPage();
    if (typeof p.name === 'string') page.name = p.name;

    const result: CreateResult = { ok: true, nodeId: page.id, name: page.name, type: page.type };
    return result;
  };
