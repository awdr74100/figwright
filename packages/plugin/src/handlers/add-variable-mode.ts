import type { ModeResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

export const createAddVariableModeHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { collectionId?: unknown; name?: unknown };
    if (typeof p.collectionId !== 'string') {
      throw new TypeError('add_variable_mode: collectionId must be a string');
    }
    if (typeof p.name !== 'string') throw new TypeError('add_variable_mode: name must be a string');

    const collection = await figmaCtx.variables.getVariableCollectionByIdAsync(p.collectionId);
    if (collection === null) {
      throw new Error(`add_variable_mode: collection ${p.collectionId} not found`);
    }
    let modeId: string;
    try {
      modeId = collection.addMode(p.name);
    } catch (err) {
      // Mode count is gated by the file's Figma plan (Starter allows 1 mode per collection).
      // Figma's raw error isn't actionable for an agent, so append the workable fallback: a paired
      // collection carrying the same variable names with the theme's values.
      const msg = err instanceof Error ? err.message : String(err);
      if (/limit|plan|upgrade|maximum/i.test(msg)) {
        throw new Error(
          `add_variable_mode: the file's Figma plan does not allow another mode on ` +
            `"${collection.name}" (${msg}). Fall back to a paired collection: create a collection ` +
            `named for the theme (e.g. "${collection.name}/${p.name}") holding the same variable ` +
            `names with that theme's values.`,
          { cause: err },
        );
      }
      throw err;
    }

    const result: ModeResult = { ok: true, modeId, name: p.name };
    return result;
  };
