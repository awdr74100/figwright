import type { VariableResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { writeStyleAtomically } from './style-snapshot.js';
import {
  explainVariableError,
  parseVariableFields,
  snapshotVariableFields,
  variableFieldsResidue,
  writeVariableFields,
} from './variable-fields.js';

const TOOL = 'update_variable';

/**
 * Update a variable in place — its name, description, scopes and whether it is published — keeping
 * its id, its values and every binding to it. Before this a variable's description could not be
 * written at all, and its scopes only when it was created.
 *
 * A call lands whole or not at all: the fields Figma can refuse (a name, scopes) are written first,
 * and a refusal puts back whatever the call had already written.
 */
export const createUpdateVariableHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { variableId?: unknown };
    if (typeof p.variableId !== 'string') {
      throw new TypeError(`${TOOL}: variableId must be a string`);
    }
    const fields = parseVariableFields(params, TOOL);

    const variable = await figmaCtx.variables.getVariableByIdAsync(p.variableId);
    if (variable === null) throw new Error(`${TOOL}: variable ${p.variableId} not found`);

    const before = snapshotVariableFields(variable, fields);
    let adjusted: string[] = [];
    try {
      await writeStyleAtomically(
        () => {
          adjusted = writeVariableFields(variable, fields);
        },
        () => {
          writeVariableFields(variable, before);
        },
        () => variableFieldsResidue(variable, before),
        'variable',
      );
    } catch (error) {
      throw explainVariableError(error, variable, TOOL);
    }

    const result: VariableResult = { ok: true, variableId: variable.id, name: variable.name };
    if (adjusted.length > 0) result.adjusted = adjusted.join('; ');
    return result;
  };
