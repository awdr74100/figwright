import type { CollectionResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

export const createCreateVariableCollectionHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  // eslint-disable-next-line @typescript-eslint/require-await
  async params => {
    const p = (params ?? {}) as { name?: unknown };
    if (typeof p.name !== 'string') {
      throw new TypeError('create_variable_collection: name must be a string');
    }

    const collection = figmaCtx.variables.createVariableCollection(p.name);

    const result: CollectionResult = {
      ok: true,
      collectionId: collection.id,
      defaultModeId: collection.defaultModeId,
      name: collection.name,
    };
    return result;
  };
