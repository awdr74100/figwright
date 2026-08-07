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

    const collection = await figmaCtx.variables.getVariableCollectionByIdAsync(p.collectionId);
    if (collection === null) {
      throw new Error(`create_variable: collection ${p.collectionId} not found`);
    }
    const variable = figmaCtx.variables.createVariable(
      p.name,
      collection,
      p.resolvedType as ResolvedType,
    );

    const result: VariableResult = { ok: true, variableId: variable.id, name: variable.name };
    return result;
  };
