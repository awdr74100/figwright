import type { VariableResult } from '@figma-mcp-relay/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

export const createDeleteVariableHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { variableId?: unknown };
    if (typeof p.variableId !== 'string') {
      throw new TypeError('delete_variable: variableId must be a string');
    }

    const variable = await figmaCtx.variables.getVariableByIdAsync(p.variableId);
    if (variable === null) throw new Error(`delete_variable: variable ${p.variableId} not found`);
    const name = variable.name; // capture before remove(), which invalidates the handle
    variable.remove();

    const result: VariableResult = { ok: true, variableId: p.variableId, name };
    return result;
  };
