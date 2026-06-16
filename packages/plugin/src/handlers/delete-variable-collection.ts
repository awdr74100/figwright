import type { DeleteCollectionResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

export const createDeleteVariableCollectionHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { collectionId?: unknown };
    if (typeof p.collectionId !== 'string') {
      throw new TypeError('delete_variable_collection: collectionId must be a string');
    }

    const collection = await figmaCtx.variables.getVariableCollectionByIdAsync(p.collectionId);
    if (collection === null) {
      throw new Error(`delete_variable_collection: collection ${p.collectionId} not found`);
    }
    const name = collection.name; // capture before remove(), which invalidates the handle
    collection.remove();

    const result: DeleteCollectionResult = { ok: true, collectionId: p.collectionId, name };
    return result;
  };
