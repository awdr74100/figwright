import type { VariableResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

// A subset of Figma's VariableResolvedDataType, which plugin-typings 1.133 widened with EASING and
// TIMING. Those two are deliberately left out: Figma's own createVariable refuses them —
// "EASING and TIMING variable creation is not currently available" — measured 2026-08-08 against an
// up-to-date editor, so offering them would only be a guaranteed failure.
//
// The whole write side is gated, not just creation: setValueForMode likewise answers "EASING
// variable editing is not supported". Such variables *can* be made in the Figma UI and read back
// fine (get-variable-defs serializes their curves), so plugins see them as read-only for now.
// Re-add both here and in the MCP tool's enum once Figma opens writing up.
const RESOLVED_TYPES = ['BOOLEAN', 'FLOAT', 'STRING', 'COLOR'] as const;
type ResolvedType = (typeof RESOLVED_TYPES)[number];

export const createCreateVariableHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as {
      name?: unknown;
      collectionId?: unknown;
      resolvedType?: unknown;
      scopes?: unknown;
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
    // reject the wrong *shape* — an empty array would clear every scope, which Figma treats as a
    // variable offered nowhere rather than everywhere.
    if (p.scopes !== undefined) {
      if (
        !Array.isArray(p.scopes) ||
        p.scopes.length === 0 ||
        p.scopes.some(scope => typeof scope !== 'string')
      ) {
        throw new TypeError('create_variable: scopes must be a non-empty array of scope names');
      }
    }

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
    // property is how Figma exposes it.
    if (p.scopes !== undefined) variable.scopes = p.scopes as VariableScope[];

    const result: VariableResult = { ok: true, variableId: variable.id, name: variable.name };
    return result;
  };
