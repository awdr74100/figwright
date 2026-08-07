import type { VariableResult } from '@figwright/shared';
import { describe, expect, it, vi } from 'vitest';

import { createCreateVariableHandler } from '../../src/handlers/create-variable.js';

const withCollection = (collection: unknown): typeof figma =>
  ({
    variables: {
      getVariableCollectionByIdAsync: async () => collection,
      createVariable: () => ({}),
    },
  }) as unknown as typeof figma;

describe('create_variable handler', () => {
  it('creates a variable in the resolved collection', async () => {
    const collection = { id: 'VC:0' };
    const createVariable = vi.fn<(name: string) => { id: string; name: string }>(
      (name: string) => ({
        id: 'V:0',
        name,
      }),
    );
    const f = {
      variables: {
        getVariableCollectionByIdAsync: async () => collection,
        createVariable,
      },
    } as unknown as typeof figma;
    const handler = createCreateVariableHandler(f);
    const result = (await handler({
      name: 'color/primary',
      collectionId: 'VC:0',
      resolvedType: 'COLOR',
    })) as VariableResult;

    expect(createVariable).toHaveBeenCalledWith('color/primary', collection, 'COLOR');
    expect(result).toEqual({ ok: true, variableId: 'V:0', name: 'color/primary' });
  });

  // plugin-typings 1.133 widened VariableResolvedDataType with EASING/TIMING, but Figma's own
  // createVariable still refuses them ("not currently available"), so they stay out of the allowlist
  // and are rejected here rather than sent on to fail. Delete this test when Figma opens creation up.
  it('rejects the motion resolvedTypes Figma cannot create yet', async () => {
    for (const resolvedType of ['EASING', 'TIMING']) {
      const createVariable = vi.fn<() => unknown>();
      const f = {
        variables: {
          getVariableCollectionByIdAsync: async () => ({ id: 'VC:0' }),
          createVariable,
        },
      } as unknown as typeof figma;
      // eslint-disable-next-line no-await-in-loop -- two fixed cases, sequential is fine
      await expect(
        createCreateVariableHandler(f)({
          name: 'motion/enter',
          collectionId: 'VC:0',
          resolvedType,
        }),
      ).rejects.toThrow(/resolvedType/);
      expect(createVariable).not.toHaveBeenCalled();
    }
  });

  it('throws on bad resolvedType, missing collection, or bad input', async () => {
    await expect(
      createCreateVariableHandler(withCollection({ id: 'VC:0' }))({
        name: 'x',
        collectionId: 'VC:0',
        resolvedType: 'NOPE',
      }),
    ).rejects.toThrow(/resolvedType/);
    await expect(
      createCreateVariableHandler(withCollection(null))({
        name: 'x',
        collectionId: 'VC:9',
        resolvedType: 'COLOR',
      }),
    ).rejects.toThrow(/not found/);
    await expect(
      createCreateVariableHandler(withCollection(null))({ collectionId: 'VC:0' }),
    ).rejects.toThrow(/name/);
  });
});
