import type { MutateResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

const STYLE_FIELDS = ['fill', 'stroke', 'effect', 'grid', 'text'] as const;
type StyleField = (typeof STYLE_FIELDS)[number];

// Each field maps to the node's async style-id setter (Figma deprecated the sync `*StyleId` setters).
const SETTER_BY_FIELD: Record<StyleField, string> = {
  fill: 'setFillStyleIdAsync',
  stroke: 'setStrokeStyleIdAsync',
  effect: 'setEffectStyleIdAsync',
  grid: 'setGridStyleIdAsync',
  text: 'setTextStyleIdAsync',
};

export const createApplyStyleToNodeHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { nodeId?: unknown; styleId?: unknown; field?: unknown };
    if (typeof p.nodeId !== 'string')
      throw new TypeError('apply_style_to_node: nodeId must be a string');
    if (typeof p.styleId !== 'string')
      throw new TypeError('apply_style_to_node: styleId must be a string');
    if (!STYLE_FIELDS.includes(p.field as StyleField)) {
      throw new TypeError(`apply_style_to_node: field must be one of ${STYLE_FIELDS.join(' / ')}`);
    }

    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    if (node === null) throw new Error(`apply_style_to_node: node ${p.nodeId} not found`);

    const setter = SETTER_BY_FIELD[p.field as StyleField];
    const fn = (node as unknown as Record<string, unknown>)[setter];
    if (typeof fn !== 'function') {
      throw new Error(
        `apply_style_to_node: node ${p.nodeId} cannot take a ${String(p.field)} style`,
      );
    }
    await (fn as (id: string) => Promise<void>).call(node, p.styleId);

    const result: MutateResult = { ok: true, nodeId: node.id };
    return result;
  };
