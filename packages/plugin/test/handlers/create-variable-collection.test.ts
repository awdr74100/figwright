import type { CollectionResult } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import { createCreateVariableCollectionHandler } from '../../src/handlers/create-variable-collection.js';

const fakeFigma = (): typeof figma =>
  ({
    variables: {
      createVariableCollection: (name: string) => ({
        id: 'VC:0',
        name,
        defaultModeId: 'M:0',
      }),
    },
  }) as unknown as typeof figma;

describe('create_variable_collection handler', () => {
  it('creates a collection and returns its id + default mode', async () => {
    const handler = createCreateVariableCollectionHandler(fakeFigma());
    const result = (await handler({ name: 'Theme' })) as CollectionResult;
    expect(result).toEqual({ ok: true, collectionId: 'VC:0', defaultModeId: 'M:0', name: 'Theme' });
  });

  it('throws when name is missing', async () => {
    await expect(createCreateVariableCollectionHandler(fakeFigma())({})).rejects.toThrow(/name/);
  });
});
