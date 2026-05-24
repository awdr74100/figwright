import type { MutateResult } from '@figma-mcp-relay/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

const VALUES = new Set(['MIN', 'CENTER', 'MAX', 'STRETCH', 'SCALE']);

export const createSetConstraintsHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { nodeId?: unknown; horizontal?: unknown; vertical?: unknown };
    if (typeof p.nodeId !== 'string') throw new TypeError('set_constraints: nodeId must be a string');
    if (typeof p.horizontal !== 'string' || !VALUES.has(p.horizontal)) {
      throw new TypeError('set_constraints: horizontal must be MIN / CENTER / MAX / STRETCH / SCALE');
    }
    if (typeof p.vertical !== 'string' || !VALUES.has(p.vertical)) {
      throw new TypeError('set_constraints: vertical must be MIN / CENTER / MAX / STRETCH / SCALE');
    }
    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    if (node === null || !('constraints' in node)) {
      throw new Error(`set_constraints: node ${p.nodeId} not found or has no constraints`);
    }
    (node as ConstraintMixin).constraints = {
      horizontal: p.horizontal as ConstraintType,
      vertical: p.vertical as ConstraintType,
    };
    const result: MutateResult = { ok: true, nodeId: node.id };
    return result;
  };
