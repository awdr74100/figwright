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

  // Figma refused EASING/TIMING creation until it opened both to plugins; measured accepted 2026-10-02.
  it('creates the motion resolvedTypes EASING and TIMING', async () => {
    for (const resolvedType of ['EASING', 'TIMING']) {
      const collection = { id: 'VC:0' };
      const createVariable = vi.fn<() => unknown>(() => ({ id: 'V:1', name: 'motion/enter' }));
      const f = {
        variables: {
          getVariableCollectionByIdAsync: async () => collection,
          createVariable,
        },
      } as unknown as typeof figma;
      // eslint-disable-next-line no-await-in-loop -- two fixed cases, sequential is fine
      await createCreateVariableHandler(f)({
        name: 'motion/enter',
        collectionId: 'VC:0',
        resolvedType,
      });
      expect(createVariable).toHaveBeenCalledWith('motion/enter', collection, resolvedType);
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

  it("applies scopes to the new variable, and leaves Figma's default alone when omitted", async () => {
    const mk = (): {
      variable: { scopes: string[] };
      handler: ReturnType<typeof createCreateVariableHandler>;
    } => {
      const variable = { id: 'V:0', name: 'radius/md', scopes: ['ALL_SCOPES'] };
      const f = {
        variables: {
          getVariableCollectionByIdAsync: async () => ({ id: 'VC:0' }),
          createVariable: () => variable,
        },
      } as unknown as typeof figma;
      return { variable, handler: createCreateVariableHandler(f) };
    };

    const scoped = mk();
    await scoped.handler({
      name: 'radius/md',
      collectionId: 'VC:0',
      resolvedType: 'FLOAT',
      scopes: ['CORNER_RADIUS'],
    });
    expect(scoped.variable.scopes).toEqual(['CORNER_RADIUS']);

    // Omitted means "no opinion": Figma's own default stays rather than being overwritten with a
    // guess, which is what makes the field's absence in get_variable_defs meaningful too.
    const bare = mk();
    await bare.handler({ name: 'radius/md', collectionId: 'VC:0', resolvedType: 'FLOAT' });
    expect(bare.variable.scopes).toEqual(['ALL_SCOPES']);
  });

  // Figma creates the variable and only then refuses the scopes assignment (measured: any scope on
  // EASING / TIMING, CORNER_RADIUS on a COLOR, FRAME_FILL on a BOOLEAN), so the refusal has to undo
  // the creation or the failed call leaves a stray, unscoped variable behind.
  it('removes the variable it created when Figma refuses its scopes', async () => {
    for (const [resolvedType, figmaMessage] of [
      ['EASING', 'in set_scopes: Cannot set scopes on this variable type'],
      ['COLOR', 'in set_scopes: Invalid scope for this variable type'],
    ] as const) {
      const remove = vi.fn<() => void>();
      const variable = {
        id: 'V:1',
        name: 'motion/enter',
        remove,
        set scopes(_: string[]) {
          throw new Error(figmaMessage);
        },
      };
      const f = {
        variables: {
          getVariableCollectionByIdAsync: async () => ({ id: 'VC:0' }),
          createVariable: () => variable,
        },
      } as unknown as typeof figma;
      // eslint-disable-next-line no-await-in-loop -- two fixed cases, sequential is fine
      await expect(
        createCreateVariableHandler(f)({
          name: 'motion/enter',
          collectionId: 'VC:0',
          resolvedType,
          scopes: ['CORNER_RADIUS'],
        }),
      ).rejects.toThrow(
        `on the new ${resolvedType} variable (${figmaMessage}), so nothing was created`,
      );
      expect(remove).toHaveBeenCalledOnce();
    }
  });

  // An empty array is the interesting one: Figma reads it as "offered nowhere", so letting it
  // through would quietly hide the variable from every picker.
  it('rejects a scopes value that is not an array of names', async () => {
    for (const scopes of ['CORNER_RADIUS', [1]]) {
      const createVariable = vi.fn<() => unknown>();
      const f = {
        variables: {
          getVariableCollectionByIdAsync: async () => ({ id: 'VC:0' }),
          createVariable,
        },
      } as unknown as typeof figma;
      await expect(
        createCreateVariableHandler(f)({
          name: 'x',
          collectionId: 'VC:0',
          resolvedType: 'FLOAT',
          scopes,
        }),
      ).rejects.toThrow('create_variable: scopes must be an array of scope names');
      expect(createVariable).not.toHaveBeenCalled();
    }
  });

  // An empty list offers the variable nowhere — a real setting (how a primitive aliased by semantic
  // tokens is hidden from the pickers), so it is written, not refused.
  it('writes an empty scopes list', async () => {
    const variable: Record<string, unknown> = { id: 'V:1', name: 'x', scopes: ['ALL_SCOPES'] };
    const f = {
      variables: {
        getVariableCollectionByIdAsync: async () => ({ id: 'VC:0' }),
        createVariable: () => variable,
      },
    } as unknown as typeof figma;
    await createCreateVariableHandler(f)({
      name: 'x',
      collectionId: 'VC:0',
      resolvedType: 'FLOAT',
      scopes: [],
    });
    expect(variable.scopes).toEqual([]);
  });

  it('writes a description and the publishing flag, and says when Figma trims the description', async () => {
    let description = '';
    const variable: Record<string, unknown> = { id: 'V:1', name: 'x', hiddenFromPublishing: false };
    Object.defineProperty(variable, 'description', {
      get: () => description,
      set: (v: string) => {
        description = v.trim();
      },
    });
    const f = {
      variables: {
        getVariableCollectionByIdAsync: async () => ({ id: 'VC:0' }),
        createVariable: () => variable,
      },
    } as unknown as typeof figma;
    const result = await createCreateVariableHandler(f)({
      name: 'x',
      collectionId: 'VC:0',
      resolvedType: 'FLOAT',
      description: '  spacing step  ',
      hiddenFromPublishing: true,
    });
    expect([description, variable.hiddenFromPublishing]).toEqual(['spacing step', true]);
    expect(result).toMatchObject({
      adjusted: expect.stringMatching(/^description was stored as "spacing step"/),
    });
  });

  it('removes the new variable when its scopes are refused, and names the scopes the type takes', async () => {
    let removed = 0;
    const variable: Record<string, unknown> = {
      id: 'V:1',
      name: 'x',
      resolvedType: 'COLOR',
      remove: () => {
        removed += 1;
      },
    };
    Object.defineProperty(variable, 'scopes', {
      get: () => ['ALL_SCOPES'],
      set: () => {
        throw new Error('in set_scopes: Invalid scope for this variable type');
      },
    });
    const f = {
      variables: {
        getVariableCollectionByIdAsync: async () => ({ id: 'VC:0' }),
        createVariable: () => variable,
      },
    } as unknown as typeof figma;
    await expect(
      createCreateVariableHandler(f)({
        name: 'x',
        collectionId: 'VC:0',
        resolvedType: 'COLOR',
        scopes: ['GAP'],
      }),
    ).rejects.toThrow(
      /^create_variable: Figma refused scopes \["GAP"\] on the new COLOR variable .* \(create_variable: a COLOR variable takes ALL_SCOPES \/ ALL_FILLS \/ FRAME_FILL \/ SHAPE_FILL \/ TEXT_FILL \/ STROKE_COLOR \/ EFFECT_COLOR, or \[\] to be offered nowhere\)$/,
    );
    expect(removed).toBe(1);
  });
});
