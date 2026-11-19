import type { CollectionResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

export const createCreateVariableCollectionHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  // eslint-disable-next-line @typescript-eslint/require-await
  async params => {
    const p = (params ?? {}) as { name?: unknown; hiddenFromPublishing?: unknown };
    if (typeof p.name !== 'string') {
      throw new TypeError('create_variable_collection: name must be a string');
    }
    if (p.hiddenFromPublishing !== undefined && typeof p.hiddenFromPublishing !== 'boolean') {
      throw new TypeError('create_variable_collection: hiddenFromPublishing must be a boolean');
    }

    const collection = figmaCtx.variables.createVariableCollection(p.name);
    // A collection a plugin creates starts hidden from publishing — one the Figma UI creates does
    // not (both measured 2026-11-20) — so the result says which it is, and a caller can change it.
    // Refused on no content (measured), so it cannot leave the new collection half made.
    if (
      typeof p.hiddenFromPublishing === 'boolean' &&
      collection.hiddenFromPublishing !== p.hiddenFromPublishing
    ) {
      collection.hiddenFromPublishing = p.hiddenFromPublishing;
    }

    const result: CollectionResult = {
      ok: true,
      collectionId: collection.id,
      defaultModeId: collection.defaultModeId,
      name: collection.name,
      hiddenFromPublishing: collection.hiddenFromPublishing,
    };
    return result;
  };
