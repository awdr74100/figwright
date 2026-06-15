import type { MutateResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

/**
 * Bind (or unbind) a COLOR variable on a node's fill/stroke paint. Figma keeps fill/stroke colour
 * bindings on the paint — not in node.boundVariables — so `node.setBoundVariable('fills', …)`
 * throws; the only path is `figma.variables.setBoundVariableForPaint`, which returns a NEW paint
 * that must be written back into a cloned array (paints are read-only).
 */
export const createBindVariableToPaintHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as {
      nodeId?: unknown;
      target?: unknown;
      index?: unknown;
      variableId?: unknown;
    };
    if (typeof p.nodeId !== 'string')
      throw new TypeError('bind_variable_to_paint: nodeId must be a string');
    const target: 'fills' | 'strokes' = p.target === 'strokes' ? 'strokes' : 'fills';
    const index = typeof p.index === 'number' ? p.index : 0;
    if (p.variableId !== null && typeof p.variableId !== 'string') {
      throw new TypeError('bind_variable_to_paint: variableId must be a string or null');
    }

    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    if (node === null || !(target in node)) {
      throw new Error(`bind_variable_to_paint: node ${p.nodeId} not found or has no ${target}`);
    }
    const paints = (node as unknown as Record<string, unknown>)[target];
    if (!Array.isArray(paints)) {
      throw new Error(`bind_variable_to_paint: ${target} on ${p.nodeId} is mixed or unreadable`);
    }
    const paint = paints[index] as Paint | undefined;
    if (paint === undefined) {
      throw new Error(`bind_variable_to_paint: no paint at ${target}[${index}] on ${p.nodeId}`);
    }
    if (paint.type !== 'SOLID') {
      throw new Error(
        `bind_variable_to_paint: ${target}[${index}] is ${paint.type}; only SOLID paints bind a colour variable`,
      );
    }

    let variable: Variable | null = null;
    if (typeof p.variableId === 'string') {
      variable = await figmaCtx.variables.getVariableByIdAsync(p.variableId);
      if (variable === null)
        throw new Error(`bind_variable_to_paint: variable ${p.variableId} not found`);
    }

    const bound = figmaCtx.variables.setBoundVariableForPaint(paint, 'color', variable);
    const next = [...(paints as Paint[])];
    next[index] = bound;
    (node as unknown as Record<string, unknown>)[target] = next;

    const result: MutateResult = { ok: true, nodeId: node.id };
    return result;
  };
