import type { DeleteCollectionResult } from '@figwright/shared';
import { describe, expect, it, vi } from 'vitest';

import { createDeleteVariableCollectionHandler } from '../../src/handlers/delete-variable-collection.js';

describe('delete_variable_collection handler', () => {
  it('removes the collection and returns its captured id + name', async () => {
    const remove = vi.fn<() => void>();
    const collection = { id: 'VC:0', name: 'Theme', remove };
    const handler = createDeleteVariableCollectionHandler({
      variables: { getVariableCollectionByIdAsync: async () => collection },
    } as unknown as typeof figma);
    const result = (await handler({ collectionId: 'VC:0' })) as DeleteCollectionResult;

    expect(remove).toHaveBeenCalledOnce();
    expect(result).toEqual({ ok: true, collectionId: 'VC:0', name: 'Theme' });
  });

  it('throws when missing or input bad', async () => {
    const f = {
      variables: { getVariableCollectionByIdAsync: async () => null },
    } as unknown as typeof figma;
    await expect(
      createDeleteVariableCollectionHandler(f)({ collectionId: 'VC:9' }),
    ).rejects.toThrow(/not found/);
    await expect(createDeleteVariableCollectionHandler(f)({})).rejects.toThrow(/collectionId/);
  });
});
