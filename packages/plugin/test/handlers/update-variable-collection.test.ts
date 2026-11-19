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

  it('sets the publishing flag, reporting it only when the call set it', async () => {
    const collection = { ...makeCollection(), hiddenFromPublishing: true };
    const handler = createUpdateVariableCollectionHandler(fakeFigma(collection));
    expect(await handler({ collectionId: 'VC:0', hiddenFromPublishing: false })).toMatchObject({
      hiddenFromPublishing: false,
    });
    expect(collection.hiddenFromPublishing).toBe(false);
    expect(await handler({ collectionId: 'VC:0', name: 'Brand' })).not.toHaveProperty(
      'hiddenFromPublishing',
    );
    await expect(handler({ collectionId: 'VC:0', hiddenFromPublishing: 1 })).rejects.toThrow(
      'update_variable_collection: hiddenFromPublishing must be a boolean',
    );
  });

  // Figma resets hiddenFromPublishing to true on any write to a collection's name, the same name
  // included (measured 2026-11-20) — which took a published collection out of the library.
  it('renames a collection without taking it out of the published library', async () => {
    const writes: string[] = [];
    let name = 'Colour';
    const collection = { ...makeCollection(), hiddenFromPublishing: false };
    Object.defineProperty(collection, 'name', {
      get: () => name,
      set: (v: string) => {
        writes.push(v);
        name = v;
        collection.hiddenFromPublishing = true;
      },
    });
    const handler = createUpdateVariableCollectionHandler(fakeFigma(collection));
    await handler({ collectionId: 'VC:0', name: 'Color' });
    expect([name, collection.hiddenFromPublishing]).toEqual(['Color', false]);
    // A name it already has is not written, so it cannot flip the flag either.
    await handler({ collectionId: 'VC:0', name: 'Color' });
    expect(writes).toEqual(['Color']);
    // A collection already hidden stays hidden.
    collection.hiddenFromPublishing = true;
    await handler({ collectionId: 'VC:0', name: 'Brand' });
    expect(collection.hiddenFromPublishing).toBe(true);
  });
});
