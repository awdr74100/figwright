import type { DeleteModeResult } from '@figwright/shared';
import { describe, expect, it, type Mock, vi } from 'vitest';

import { createDeleteVariableModeHandler } from '../../src/handlers/delete-variable-mode.js';

interface FakeMode {
  modeId: string;
  name: string;
}

/** A collection whose `removeMode` really drops the mode, so the post-state is observable. */
const makeCollection = (): {
  id: string;
  name: string;
  modes: FakeMode[];
  removeMode: Mock<(modeId: string) => void>;
} => {
  const collection = {
    id: 'VC:0',
    name: 'Colour',
    modes: [
      { modeId: 'M:0', name: 'Light' },
      { modeId: 'M:1', name: 'Dark' },
    ] as FakeMode[],
    removeMode: vi.fn<(modeId: string) => void>(modeId => {
      collection.modes = collection.modes.filter(m => m.modeId !== modeId);
    }),
  };
  return collection;
};

const fakeFigma = (collection: unknown): typeof figma =>
  ({
    variables: { getVariableCollectionByIdAsync: async () => collection },
  }) as unknown as typeof figma;

describe('delete_variable_mode handler', () => {
  it('removes the mode and reports the name it had', async () => {
    const collection = makeCollection();
    const handler = createDeleteVariableModeHandler(fakeFigma(collection));
    const result = (await handler({
      collectionId: 'VC:0',
      modeId: 'M:1',
    })) as DeleteModeResult;

    expect(collection.removeMode).toHaveBeenCalledWith('M:1');
    expect(collection.modes).toEqual([{ modeId: 'M:0', name: 'Light' }]);
    // The name has to be read before the removal — afterwards the id resolves to nothing, and this
    // is the caller's only confirmation that the intended mode went.
    expect(result).toEqual({ ok: true, collectionId: 'VC:0', modeId: 'M:1', name: 'Dark' });
  });

  it('leaves the collection untouched when the mode id is unknown', async () => {
    const collection = makeCollection();
    const handler = createDeleteVariableModeHandler(fakeFigma(collection));

    await expect(handler({ collectionId: 'VC:0', modeId: 'M:9' })).rejects.toThrow(
      /has no mode M:9/,
    );
    expect(collection.removeMode).not.toHaveBeenCalled();
    expect(collection.modes).toHaveLength(2);
  });

  // Figma refuses the last mode with this exact wording (measured against a live file), and it
  // already names the constraint, so it is passed through rather than re-wrapped.
  it("passes Figma's own last-mode refusal through untouched", async () => {
    const collection = makeCollection();
    collection.removeMode = vi.fn<(modeId: string) => void>(() => {
      throw new Error('in removeMode: Could not delete last mode in collection');
    });
    const handler = createDeleteVariableModeHandler(fakeFigma(collection));

    await expect(handler({ collectionId: 'VC:0', modeId: 'M:0' })).rejects.toThrow(
      /^in removeMode: Could not delete last mode in collection$/,
    );
  });

  it('rejects bad input and a missing collection', async () => {
    const collection = makeCollection();
    const ok = createDeleteVariableModeHandler(fakeFigma(collection));

    await expect(ok({ modeId: 'M:0' })).rejects.toThrow(/collectionId/);
    await expect(ok({ collectionId: 'VC:0' })).rejects.toThrow(/modeId/);
    await expect(
      createDeleteVariableModeHandler(fakeFigma(null))({ collectionId: 'VC:9', modeId: 'M:0' }),
    ).rejects.toThrow(/not found/);
  });
});
