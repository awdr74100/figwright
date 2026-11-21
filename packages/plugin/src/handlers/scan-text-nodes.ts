import type { SandboxToolHandler } from '../dispatcher.js';
import { resultCharBudget, serializeFlatNodes, toNodeListResult } from '../serializer.js';
import { collectMatches, resolveScope } from '../traverse.js';
import { TEXT_SUBLAYER_TYPES } from './text-sublayer.js';

export const createScanTextNodesHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const root = (params as { root?: unknown } | null)?.root;
    const scope = await resolveScope(figmaCtx, root);

    // Text set along a path is copy too — the wording of a badge or a seal — and so is the caption
    // a FigJam sticky, shape, table cell or connector keeps in a sublayer of its own.
    const matches = await collectMatches(
      scope,
      node =>
        node.type === 'TEXT' || node.type === 'TEXT_PATH' || TEXT_SUBLAYER_TYPES.has(node.type),
    );
    return toNodeListResult(matches, await serializeFlatNodes(matches, resultCharBudget()));
  };
