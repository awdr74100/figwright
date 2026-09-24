import type { UpdateCollectionResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

/** One validated mode rename: the id is known to exist on the collection it came with. */
interface ModeRename {
  modeId: string;
  name: string;
}

/**
 * Validate the `modes` argument against the collection it targets, before anything is written.
 *
 * Renaming is one `renameMode` call per mode, so an id that turns out not to exist partway through
 * would leave the collection half renamed — and the caller could not tell which half landed, since
 * the error names only the id that failed. Checking every id up front against `collection.modes` is
 * what keeps the failure atomic, the same reason a batch validates its whole op list before
 * mutating anything.
 *
 * A repeated id is refused rather than resolved: "last one wins" is a rule the caller never asked
 * for, and a duplicate means the two entries disagree about what that mode should be called.
 */
const parseModes = (raw: unknown, collection: VariableCollection): ModeRename[] => {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new TypeError('update_variable_collection: modes must be an array');
  }
  const seen = new Set<string>();
  return raw.map((entry, i) => {
    const m = (entry ?? {}) as { modeId?: unknown; name?: unknown };
    if (typeof m.modeId !== 'string') {
      throw new TypeError(`update_variable_collection: modes[${i}].modeId must be a string`);
    }
    if (typeof m.name !== 'string' || m.name.length === 0) {
      throw new TypeError(
        `update_variable_collection: modes[${i}].name must be a non-empty string`,
      );
    }
    if (!collection.modes.some(mode => mode.modeId === m.modeId)) {
      throw new Error(
        `update_variable_collection: collection "${collection.name}" has no mode ${m.modeId}`,
      );
    }
    if (seen.has(m.modeId)) {
      throw new Error(`update_variable_collection: modes names ${m.modeId} more than once`);
    }
    seen.add(m.modeId);
    return { modeId: m.modeId, name: m.name };
  });
};

/**
 * Rename a variable collection and/or its modes.
 *
 * Renaming changes no id, which is the whole point: a mis-named collection can be corrected in
 * place, where deleting and recreating it would mint a new id and take its variables and modes with
 * it. Both arguments are optional and an empty call is a no-op that reports the current state, the
 * same shape the style update handlers use.
 *
 * Whether two modes may end up sharing a name is Figma's call, not this handler's: `renameMode`
 * accepts a name already in use (measured 2026-09-24), so refusing it here would be stricter than
 * the editor itself. A repeated mode _id_ is a different matter — see {@link parseModes}.
 */
export const createUpdateVariableCollectionHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { collectionId?: unknown; name?: unknown; modes?: unknown };
    if (typeof p.collectionId !== 'string') {
      throw new TypeError('update_variable_collection: collectionId must be a string');
    }
    if (p.name !== undefined && (typeof p.name !== 'string' || p.name.length === 0)) {
      throw new TypeError('update_variable_collection: name must be a non-empty string');
    }

    const collection = await figmaCtx.variables.getVariableCollectionByIdAsync(p.collectionId);
    if (collection === null) {
      throw new Error(`update_variable_collection: collection ${p.collectionId} not found`);
    }

    const renames = parseModes(p.modes, collection);

    if (typeof p.name === 'string') collection.name = p.name;
    for (const rename of renames) collection.renameMode(rename.modeId, rename.name);

    const result: UpdateCollectionResult = {
      ok: true,
      collectionId: collection.id,
      name: collection.name,
      modes: collection.modes.map(mode => ({ modeId: mode.modeId, name: mode.name })),
    };
    return result;
  };
