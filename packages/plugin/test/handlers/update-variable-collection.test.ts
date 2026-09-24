import type { UpdateCollectionResult } from '@figwright/shared';
import { describe, expect, it, type Mock, vi } from 'vitest';

import { createUpdateVariableCollectionHandler } from '../../src/handlers/update-variable-collection.js';

interface FakeMode {
  modeId: string;
  name: string;
}

/**
 * A collection whose `renameMode` actually mutates its own `modes`, so a test can tell the
 * difference between "the call was made" and "the collection now reads that way" — the second is
 * what the handler echoes back.
 */
const makeCollection = (
  modes: FakeMode[] = [
    { modeId: 'M:0', name: 'Light' },
    { modeId: 'M:1', name: 'Dark' },
  ],
): {
  id: string;
  name: string;
  modes: FakeMode[];
  renameMode: Mock<(modeId: string, name: string) => void>;
} => {
  const collection = {
    id: 'VC:0',
    name: 'Colour',
    modes,
    renameMode: vi.fn<(modeId: string, name: string) => void>((modeId, name) => {
      const mode = collection.modes.find(m => m.modeId === modeId);
      if (mode !== undefined) mode.name = name;
    }),
  };
  return collection;
};

const fakeFigma = (collection: unknown): typeof figma =>
  ({
    variables: { getVariableCollectionByIdAsync: async () => collection },
  }) as unknown as typeof figma;

describe('update_variable_collection handler', () => {
  it('renames the collection and leaves its id and modes alone', async () => {
    const collection = makeCollection();
    const handler = createUpdateVariableCollectionHandler(fakeFigma(collection));
    const result = (await handler({
      collectionId: 'VC:0',
      name: 'Color',
    })) as UpdateCollectionResult;

    expect(collection.name).toBe('Color');
    expect(collection.renameMode).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      collectionId: 'VC:0',
      name: 'Color',
      modes: [
        { modeId: 'M:0', name: 'Light' },
        { modeId: 'M:1', name: 'Dark' },
      ],
    });
  });

  it('renames several modes in one call and echoes the whole list back', async () => {
    const collection = makeCollection();
    const handler = createUpdateVariableCollectionHandler(fakeFigma(collection));
    const result = (await handler({
      collectionId: 'VC:0',
      modes: [
        { modeId: 'M:0', name: 'Day' },
        { modeId: 'M:1', name: 'Night' },
      ],
    })) as UpdateCollectionResult;

    expect(collection.renameMode).toHaveBeenCalledTimes(2);
    expect(collection.name).toBe('Colour');
    expect(result.modes).toEqual([
      { modeId: 'M:0', name: 'Day' },
      { modeId: 'M:1', name: 'Night' },
    ]);
  });

  it('changes nothing when both arguments are omitted, and reports the current state', async () => {
    const collection = makeCollection();
    const handler = createUpdateVariableCollectionHandler(fakeFigma(collection));
    const result = (await handler({ collectionId: 'VC:0' })) as UpdateCollectionResult;

    expect(collection.name).toBe('Colour');
    expect(collection.renameMode).not.toHaveBeenCalled();
    expect(result.name).toBe('Colour');
  });

  // The reason every mode id is checked up front: renaming is one call per mode, so a bad id
  // halfway would otherwise leave the collection partly renamed with no way to tell which half.
  it('writes nothing at all when one mode id does not exist', async () => {
    const collection = makeCollection();
    const handler = createUpdateVariableCollectionHandler(fakeFigma(collection));

    await expect(
      handler({
        collectionId: 'VC:0',
        name: 'Color',
        modes: [
          { modeId: 'M:0', name: 'Day' },
          { modeId: 'M:nope', name: 'Night' },
        ],
      }),
    ).rejects.toThrow(/has no mode M:nope/);

    expect(collection.name).toBe('Colour');
    expect(collection.renameMode).not.toHaveBeenCalled();
    expect(collection.modes.map(m => m.name)).toEqual(['Light', 'Dark']);
  });

  it('refuses a mode id named twice rather than letting the last one win', async () => {
    const collection = makeCollection();
    const handler = createUpdateVariableCollectionHandler(fakeFigma(collection));

    await expect(
      handler({
        collectionId: 'VC:0',
        modes: [
          { modeId: 'M:0', name: 'Day' },
          { modeId: 'M:0', name: 'Daylight' },
        ],
      }),
    ).rejects.toThrow(/more than once/);
    expect(collection.renameMode).not.toHaveBeenCalled();
  });

  it('rejects bad input and a missing collection', async () => {
    const collection = makeCollection();
    const ok = createUpdateVariableCollectionHandler(fakeFigma(collection));

    await expect(ok({})).rejects.toThrow(/collectionId/);
    await expect(ok({ collectionId: 'VC:0', name: '' })).rejects.toThrow(/non-empty/);
    await expect(ok({ collectionId: 'VC:0', modes: 'nope' })).rejects.toThrow(/must be an array/);
    await expect(ok({ collectionId: 'VC:0', modes: [{ modeId: 'M:0' }] })).rejects.toThrow(
      /modes\[0\]\.name/,
    );
    await expect(
      createUpdateVariableCollectionHandler(fakeFigma(null))({ collectionId: 'VC:9' }),
    ).rejects.toThrow(/not found/);
  });
});
