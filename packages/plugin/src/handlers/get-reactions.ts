import type {
  GetReactionsResult,
  SerializedAction,
  SerializedReaction,
  SerializedTrigger,
} from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

const serializeTrigger = (trigger: Trigger | null): SerializedTrigger | null => {
  if (trigger === null) return null;
  const out: SerializedTrigger = { type: trigger.type };
  if ('timeout' in trigger) out.timeout = trigger.timeout;
  if ('delay' in trigger) out.delay = trigger.delay;
  return out;
};

const serializeAction = (action: Action): SerializedAction => {
  const out: SerializedAction = { type: action.type };
  if ('destinationId' in action) out.destinationId = action.destinationId;
  if ('navigation' in action) out.navigation = String(action.navigation);
  if ('url' in action) out.url = action.url;
  if ('transition' in action) {
    out.transition =
      action.transition === null
        ? null
        : {
            type: action.transition.type,
            ...('duration' in action.transition ? { duration: action.transition.duration } : {}),
          };
  }
  return out;
};

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
