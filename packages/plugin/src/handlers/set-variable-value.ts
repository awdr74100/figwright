import type { SerializedVariableValue, VariableResult } from '@figma-mcp-relay/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { toFigmaVariableValue } from './convert.js';

export const createSetVariableValueHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { variableId?: unknown; modeId?: unknown; value?: unknown };
    if (typeof p.variableId !== 'string') {
      throw new TypeError('set_variable_value: variableId must be a string');
    }
    if (typeof p.modeId !== 'string') throw new TypeError('set_variable_value: modeId must be a string');
    if (p.value === undefined) throw new TypeError('set_variable_value: value is required');

    const variable = await figmaCtx.variables.getVariableByIdAsync(p.variableId);
    if (variable === null) {
      throw new Error(`set_variable_value: variable ${p.variableId} not found`);
    }
    variable.setValueForMode(p.modeId, toFigmaVariableValue(p.value as SerializedVariableValue));

    const result: VariableResult = { ok: true, variableId: variable.id, name: variable.name };
    return result;
  };
