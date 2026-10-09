import { TOOL_RESULT_BUDGET_BYTES } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { serializeFlatNodes, toNodeListResult } from '../serializer.js';
import { collectMatches, resolveScope } from '../traverse.js';

export const createScanTextNodesHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const root = (params as { root?: unknown } | null)?.root;
    const scope = await resolveScope(figmaCtx, root);

    const matches = await collectMatches(scope, node => node.type === 'TEXT');
    return toNodeListResult(matches, await serializeFlatNodes(matches, TOOL_RESULT_BUDGET_BYTES));
  };
