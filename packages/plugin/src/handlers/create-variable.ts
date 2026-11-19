import type { VariableResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import {
  explainVariableError,
  parseVariableFields,
  writeVariableFields,
} from './variable-fields.js';

// Figma's VariableResolvedDataType. EASING and TIMING were refused by createVariable on 2026-08-08
// and accepted on 2026-10-02 (measured both times). A new EASING variable starts as
// CUSTOM_CUBIC_BEZIER (0.5, 0, 0.5, 1), a TIMING one at 0 seconds (measured).
const RESOLVED_TYPES = ['BOOLEAN', 'FLOAT', 'STRING', 'COLOR', 'EASING', 'TIMING'] as const;
type ResolvedType = (typeof RESOLVED_TYPES)[number];

export const createCreateVariableHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as {
      name?: unknown;
      collectionId?: unknown;
      resolvedType?: unknown;
      scopes?: unknown;
      description?: unknown;
      hiddenFromPublishing?: unknown;
    };
    if (typeof p.name !== 'string') throw new TypeError('create_variable: name must be a string');
    if (typeof p.collectionId !== 'string') {
      throw new TypeError('create_variable: collectionId must be a string');
    }
    if (!RESOLVED_TYPES.includes(p.resolvedType as ResolvedType)) {
      throw new TypeError(
        `create_variable: resolvedType must be one of ${RESOLVED_TYPES.join(' / ')}`,
      );
    }
    // The member names are checked against Figma's enum by the MCP tool schema, so this only has to
    // reject the wrong *shape*. An empty array is a real setting, not a mistake: it offers the
    // variable nowhere — how a primitive that semantic tokens alias is kept out of the pickers —
    // and Figma takes it on a COLOR, FLOAT or STRING (refusing it on a BOOLEAN; measured).
    if (p.scopes !== undefined) {
      if (!Array.isArray(p.scopes) || p.scopes.some(scope => typeof scope !== 'string')) {
        throw new TypeError('create_variable: scopes must be an array of scope names');
      }
    }
    const extra = parseVariableFields(
      { description: p.description, hiddenFromPublishing: p.hiddenFromPublishing },
      'create_variable',
    );

    const collection = await figmaCtx.variables.getVariableCollectionByIdAsync(p.collectionId);
    if (collection === null) {
      throw new Error(`create_variable: collection ${p.collectionId} not found`);
    }
    const variable = figmaCtx.variables.createVariable(
      p.name,
      collection,
      p.resolvedType as ResolvedType,
    );

    // Scopes are set after creation: createVariable takes no scope argument, and assigning the
    // property is how Figma exposes it. Figma refuses a scope that does not fit the type — "Invalid
    // scope for this variable type" for, say, CORNER_RADIUS on a COLOR, "Cannot set scopes on this
    // variable type" for any scope on EASING / TIMING (measured) — and by then the variable exists, so
    // a refusal removes it again: the call either creates the variable it describes or nothing.
    if (p.scopes !== undefined) {
      try {
        variable.scopes = p.scopes as VariableScope[];
      } catch (err) {
        // Read before the removal: a removed variable is not read again.
        const identity = {
          id: variable.id,
          name: variable.name,
          resolvedType: variable.resolvedType,
          remote: false,
        };
        variable.remove();
        const reason = err instanceof Error ? err.message : String(err);
        throw explainVariableError(
          new Error(
            `create_variable: Figma refused scopes ${JSON.stringify(p.scopes)} on the new ` +
              `${String(p.resolvedType)} variable (${reason}), so nothing was created. EASING and ` +
              'TIMING variables take no scopes; other types take only scopes that fit them.',
            { cause: err },
          ),
          identity,
          'create_variable',
        );
      }
    }

    // A description and the publishing flag are refused on no content (measured), but a refusal
    // still leaves no half-made variable behind.
    let adjusted: string[] = [];
    try {
      adjusted = writeVariableFields(variable, extra);
    } catch (err) {
      variable.remove();
      throw err;
    }

    const result: VariableResult = { ok: true, variableId: variable.id, name: variable.name };
    if (adjusted.length > 0) result.adjusted = adjusted.join('; ');
    return result;
  };
