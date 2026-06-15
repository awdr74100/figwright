import type { MutateResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

export const createBindVariableToNodeHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { nodeId?: unknown; field?: unknown; variableId?: unknown };
    if (typeof p.nodeId !== 'string')
      throw new TypeError('bind_variable_to_node: nodeId must be a string');
    if (typeof p.field !== 'string')
      throw new TypeError('bind_variable_to_node: field must be a string');
    if (p.variableId !== null && typeof p.variableId !== 'string') {
      throw new TypeError('bind_variable_to_node: variableId must be a string or null');
    }
    // Fill/stroke colour bindings live on the paint, not the node — setBoundVariable rejects them.
    // Point the caller at the right tool instead of surfacing Figma's opaque error.
    if (p.field === 'fills' || p.field === 'strokes') {
      throw new Error(
        `bind_variable_to_node: "${p.field}" is a paint-level colour binding — use bind_variable_to_paint instead`,
      );
    }

    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    if (node === null) throw new Error(`bind_variable_to_node: node ${p.nodeId} not found`);
    if (typeof (node as { setBoundVariable?: unknown }).setBoundVariable !== 'function') {
      throw new Error(`bind_variable_to_node: node ${p.nodeId} cannot bind variables`);
    }

    // variableId: null unbinds the field (setBoundVariable(field, null)); a string binds it.
    let variable: Variable | null = null;
    if (typeof p.variableId === 'string') {
      variable = await figmaCtx.variables.getVariableByIdAsync(p.variableId);
      if (variable === null)
        throw new Error(`bind_variable_to_node: variable ${p.variableId} not found`);
    }
    (node as SceneNode).setBoundVariable(p.field as VariableBindableNodeField, variable);

    const result: MutateResult = { ok: true, nodeId: node.id };
    return result;
  };
