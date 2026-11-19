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

  // A collection a plugin creates starts hidden from publishing (measured), so the result says so.
  it('reports whether the new collection is published, and sets it when asked', async () => {
    const made: Record<string, unknown>[] = [];
    const f = {
      variables: {
        createVariableCollection: (name: string) => {
          const c = { id: 'VC:0', name, defaultModeId: 'M:0', hiddenFromPublishing: true };
          made.push(c);
          return c;
        },
      },
    } as unknown as typeof figma;
    const handler = createCreateVariableCollectionHandler(f);
    expect(await handler({ name: 'Theme' })).toEqual({
      ok: true,
      collectionId: 'VC:0',
      defaultModeId: 'M:0',
      name: 'Theme',
      hiddenFromPublishing: true,
    });
    expect(await handler({ name: 'Brand', hiddenFromPublishing: false })).toMatchObject({
      hiddenFromPublishing: false,
    });
    expect(made[1]?.hiddenFromPublishing).toBe(false);
    await expect(handler({ name: 'x', hiddenFromPublishing: 'no' })).rejects.toThrow(
      'create_variable_collection: hiddenFromPublishing must be a boolean',
    );
    expect(made).toHaveLength(2);
  });
});
