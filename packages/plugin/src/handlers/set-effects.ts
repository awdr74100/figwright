import type { MutateResult, SerializedEffect } from '@figma-mcp-relay/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { toFigmaEffect } from './convert.js';

export const createSetEffectsHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { nodeId?: unknown; effects?: unknown };
    if (typeof p.nodeId !== 'string') throw new TypeError('set_effects: nodeId must be a string');
    if (!Array.isArray(p.effects)) throw new TypeError('set_effects: effects must be an array');

    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    if (node === null || !('effects' in node)) {
      throw new Error(`set_effects: node ${p.nodeId} not found or cannot have effects`);
    }
    (node as BlendMixin).effects = (p.effects as SerializedEffect[]).map(toFigmaEffect);

    const result: MutateResult = { ok: true, nodeId: node.id };
    return result;
  };
