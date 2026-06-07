import type { MutateResult } from '@figma-mcp-relay/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

/**
 * Set a node's auto-layout child properties (layoutAlign / layoutGrow / layoutPositioning). These
 * only have an effect when the node sits inside an auto-layout frame, but Figma exposes them on any
 * SceneNode, so we set whatever is provided and leave the rest unchanged.
 */
export const createSetLayoutPropsHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as {
      nodeId?: unknown;
      layoutAlign?: unknown;
      layoutGrow?: unknown;
      layoutPositioning?: unknown;
    };
    if (typeof p.nodeId !== 'string')
      throw new TypeError('set_layout_props: nodeId must be a string');
    if (p.layoutGrow !== undefined && (typeof p.layoutGrow !== 'number' || p.layoutGrow < 0)) {
      throw new TypeError('set_layout_props: layoutGrow must be a non-negative number');
    }

    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    if (node === null) throw new Error(`set_layout_props: node ${p.nodeId} not found`);
    if (!('layoutAlign' in node)) {
      throw new Error(`set_layout_props: node ${p.nodeId} has no auto-layout child properties`);
    }
    const n = node as SceneNode & {
      layoutAlign: string;
      layoutGrow: number;
      layoutPositioning: string;
    };

    if (typeof p.layoutAlign === 'string') n.layoutAlign = p.layoutAlign;
    if (typeof p.layoutGrow === 'number') n.layoutGrow = p.layoutGrow;
    if (typeof p.layoutPositioning === 'string') n.layoutPositioning = p.layoutPositioning;

    const result: MutateResult = { ok: true, nodeId: node.id };
    return result;
  };
