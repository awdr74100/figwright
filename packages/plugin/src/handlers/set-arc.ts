import type { MutateResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

export const createSetArcHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as {
      nodeId?: unknown;
      startingAngle?: unknown;
      endingAngle?: unknown;
      innerRadius?: unknown;
    };
    if (typeof p.nodeId !== 'string') throw new TypeError('set_arc: nodeId must be a string');
    if (p.startingAngle !== undefined && typeof p.startingAngle !== 'number') {
      throw new TypeError('set_arc: startingAngle must be a number (radians)');
    }
    if (p.endingAngle !== undefined && typeof p.endingAngle !== 'number') {
      throw new TypeError('set_arc: endingAngle must be a number (radians)');
    }
    if (
      p.innerRadius !== undefined &&
      (typeof p.innerRadius !== 'number' || p.innerRadius < 0 || p.innerRadius > 1)
    ) {
      throw new TypeError('set_arc: innerRadius must be a number between 0 and 1');
    }
    if (
      p.startingAngle === undefined &&
      p.endingAngle === undefined &&
      p.innerRadius === undefined
    ) {
      throw new TypeError(
        'set_arc: provide at least one of startingAngle, endingAngle, innerRadius',
      );
    }
    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    if (node === null || !('arcData' in node)) {
      throw new Error(`set_arc: node ${p.nodeId} not found or is not an ellipse`);
    }
    // Figma requires the whole arcData object at once, so merge the given fields over the current
    // value — a caller can tweak just innerRadius (make a donut) without resetting the angles.
    const ellipse = node as EllipseNode;
    const current = ellipse.arcData;
    ellipse.arcData = {
      startingAngle: typeof p.startingAngle === 'number' ? p.startingAngle : current.startingAngle,
      endingAngle: typeof p.endingAngle === 'number' ? p.endingAngle : current.endingAngle,
      innerRadius: typeof p.innerRadius === 'number' ? p.innerRadius : current.innerRadius,
    };
    const result: MutateResult = { ok: true, nodeId: node.id };
    return result;
  };
