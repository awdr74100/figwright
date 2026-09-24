import type { DeleteModeResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

/**
 * Remove a mode from a variable collection.
 *
 * Not reversible: adding a mode back mints a new mode id, so every variable value that hung on the
 * removed id stays gone. That is why the tool is refused inside a batch, and why the name is read
 * out before the removal — afterwards the id resolves to nothing, and the name is the only
 * confirmation the caller gets that the right mode went.
 *
 * Figma's own guards are passed through rather than pre-empted, having been measured (2026-09-24)
 * rather than assumed — the typings document neither:
 *
 * - Removing the collection's _default_ mode is allowed. Figma moves `defaultModeId` to a mode that
 *   remains, so guarding against it here would refuse a legal edit.
 * - Removing the _last_ mode is refused, with `in removeMode: Could not delete last mode in
 *   collection`. That message already names the constraint and the fix, so re-wrapping it would add
 *   a layer without adding information — unlike the plan-tier ceiling on adding a mode, where
 *   Figma's own text leaves the caller with nowhere to go.
 */
export const createDeleteVariableModeHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { collectionId?: unknown; modeId?: unknown };
    if (typeof p.collectionId !== 'string') {
      throw new TypeError('delete_variable_mode: collectionId must be a string');
    }
    if (typeof p.modeId !== 'string') {
      throw new TypeError('delete_variable_mode: modeId must be a string');
    }

    const collection = await figmaCtx.variables.getVariableCollectionByIdAsync(p.collectionId);
    if (collection === null) {
      throw new Error(`delete_variable_mode: collection ${p.collectionId} not found`);
    }
    const mode = collection.modes.find(m => m.modeId === p.modeId);
    if (mode === undefined) {
      throw new Error(
        `delete_variable_mode: collection "${collection.name}" has no mode ${p.modeId}`,
      );
    }
    const { name } = mode;
    collection.removeMode(p.modeId);

    const result: DeleteModeResult = {
      ok: true,
      collectionId: collection.id,
      modeId: p.modeId,
      name,
    };
    return result;
  };
