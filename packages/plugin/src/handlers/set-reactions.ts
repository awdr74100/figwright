import type { MutateResult, SerializedReaction } from '@figma-mcp-relay/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { toFigmaReaction } from './convert.js';

/** Replace a node's prototype reactions. Uses setReactionsAsync (required under dynamic-page). */
export const createSetReactionsHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { nodeId?: unknown; reactions?: unknown };
    if (typeof p.nodeId !== 'string') throw new TypeError('set_reactions: nodeId must be a string');
    if (!Array.isArray(p.reactions))
      throw new TypeError('set_reactions: reactions must be an array');

    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    if (
      node === null ||
      typeof (node as { setReactionsAsync?: unknown }).setReactionsAsync !== 'function'
    ) {
      throw new Error(`set_reactions: node ${p.nodeId} not found or cannot have reactions`);
    }
    await (node as ReactionMixin).setReactionsAsync(
      (p.reactions as SerializedReaction[]).map(toFigmaReaction),
    );

    const result: MutateResult = { ok: true, nodeId: node.id };
    return result;
  };
