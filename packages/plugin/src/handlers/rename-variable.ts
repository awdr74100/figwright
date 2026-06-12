import type { VariableResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

export const createRenameVariableHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { variableId?: unknown; name?: unknown };
    if (typeof p.variableId !== 'string')
      throw new TypeError('rename_variable: variableId must be a string');
    if (typeof p.name !== 'string' || p.name.length === 0) {
      throw new TypeError('rename_variable: name must be a non-empty string');
    }
    const variable = await figmaCtx.variables.getVariableByIdAsync(p.variableId);
    if (variable === null) throw new Error(`rename_variable: variable ${p.variableId} not found`);
    variable.name = p.name;

    const result: VariableResult = { ok: true, variableId: variable.id, name: variable.name };
    return result;
  };
