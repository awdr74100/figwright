import type { MutateResult } from '@figma-mcp-relay/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

export const createBindVariableToNodeHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { nodeId?: unknown; field?: unknown; variableId?: unknown };
    if (typeof p.nodeId !== 'string')
      throw new TypeError('bind_variable_to_node: nodeId must be a string');
    if (typeof p.field !== 'string')
      throw new TypeError('bind_variable_to_node: field must be a string');
    if (typeof p.variableId !== 'string') {
      throw new TypeError('bind_variable_to_node: variableId must be a string');
    }

    const [node, variable] = await Promise.all([
      figmaCtx.getNodeByIdAsync(p.nodeId),
      figmaCtx.variables.getVariableByIdAsync(p.variableId),
    ]);
    if (node === null) throw new Error(`bind_variable_to_node: node ${p.nodeId} not found`);
    if (variable === null)
      throw new Error(`bind_variable_to_node: variable ${p.variableId} not found`);
    if (typeof (node as { setBoundVariable?: unknown }).setBoundVariable !== 'function') {
      throw new Error(`bind_variable_to_node: node ${p.nodeId} cannot bind variables`);
    }
    (node as SceneNode).setBoundVariable(p.field as VariableBindableNodeField, variable);

    const result: MutateResult = { ok: true, nodeId: node.id };
    return result;
  };
