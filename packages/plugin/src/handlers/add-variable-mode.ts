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
    const modeId = collection.addMode(p.name);

    const result: ModeResult = { ok: true, modeId, name: p.name };
    return result;
  };
