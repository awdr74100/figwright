import type { VariableResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

export const createImportVariableHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { variableKey?: unknown };
    if (typeof p.variableKey !== 'string' || p.variableKey.length === 0) {
      throw new TypeError('import_variable: variableKey must be a non-empty string');
    }

    // Figma owns publishing/access checks and the target-file id. Never construct an id from
    // the key or a source-library id, nor replace the library reference with a local copy.
    const variable = await figmaCtx.variables.importVariableByKeyAsync(p.variableKey);
    const result: VariableResult = { ok: true, variableId: variable.id, name: variable.name };
    return result;
  };
