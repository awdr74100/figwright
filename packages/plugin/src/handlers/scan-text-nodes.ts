import type { SandboxToolHandler } from '../dispatcher.js';
import { resultCharBudget, serializeFlatNodes, toNodeListResult } from '../serializer.js';
import { collectMatches, resolveScope } from '../traverse.js';

export const createScanTextNodesHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const root = (params as { root?: unknown } | null)?.root;
    const scope = await resolveScope(figmaCtx, root);

    // Text set along a path is copy too — the wording of a badge or a seal.
    const matches = await collectMatches(
      scope,
      node => node.type === 'TEXT' || node.type === 'TEXT_PATH',
    );
    return toNodeListResult(matches, await serializeFlatNodes(matches, resultCharBudget()));
  };
