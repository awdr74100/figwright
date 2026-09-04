import type {
  GetReactionsResult,
  SerializedAction,
  SerializedReaction,
  SerializedTrigger,
} from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

// Reactions are copied whole, not field by field. `get_reactions` output is exactly what
// `set_reactions` takes back, and Figma's Trigger/Action unions carry required per-variant fields
// (ON_KEY_DOWN's keyCodes, SET_VARIABLE's variableId, a directional transition's direction and
// matchLayers, an overlay's overlayRelativePosition) that a picked subset drops — writing the
// reaction back incomplete. See SerializedActionSchema for the full surface.
//
// The casts are structural noise, not looseness: Figma types `keyCodes` as `readonly number[]`,
// which will not widen to the wire format's mutable array, and `Action.navigation` resolves to the
// DOM's `Navigation` interface rather than the plugin typings' string union — lib.dom declares that
// name too, and it wins the global collision. (The `String(navigation)` this replaces was working
// around the same thing.)
const serializeTrigger = (trigger: Trigger | null): SerializedTrigger | null =>
  trigger === null ? null : ({ ...trigger } as SerializedTrigger);

const serializeAction = (action: Action): SerializedAction => ({ ...action }) as SerializedAction;

const serializeReaction = (reaction: Reaction): SerializedReaction => {
  const actions = reaction.actions ?? (reaction.action === undefined ? [] : [reaction.action]);
  return {
    trigger: serializeTrigger(reaction.trigger),
    actions: actions.map(serializeAction),
  };
};

const hasReactions = (node: BaseNode): node is BaseNode & { reactions: readonly Reaction[] } =>
  'reactions' in node && Array.isArray((node as { reactions?: unknown }).reactions);

export const createGetReactionsHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const nodeId = (params as { nodeId?: unknown } | null)?.nodeId;
    if (typeof nodeId !== 'string') {
      throw new TypeError('get_reactions: nodeId must be a string');
    }
    const node = await figmaCtx.getNodeByIdAsync(nodeId);
    const reactions =
      node !== null && hasReactions(node) ? node.reactions.map(serializeReaction) : [];
    const result: GetReactionsResult = { nodeId, reactions };
    return result;
  };
