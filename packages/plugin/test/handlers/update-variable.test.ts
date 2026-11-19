import type { VariableResult } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import { createUpdateVariableHandler } from '../../src/handlers/update-variable.js';

const fakeFigma = (variable: unknown): typeof figma =>
  ({ variables: { getVariableByIdAsync: async () => variable } }) as unknown as typeof figma;

const makeVariable = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'V:1',
  name: 'color/brand',
  description: '',
  scopes: ['ALL_SCOPES'],
  hiddenFromPublishing: false,
  resolvedType: 'COLOR',
  remote: false,
  ...over,
});

describe('update_variable handler', () => {
  it('writes every field it is given, in place', async () => {
    const v = makeVariable();
    const result = (await createUpdateVariableHandler(fakeFigma(v))({
      variableId: 'V:1',
      name: 'color/primary',
      description: 'The brand colour',
      scopes: ['FRAME_FILL', 'SHAPE_FILL'],
      hiddenFromPublishing: true,
    })) as VariableResult;
    expect(result).toEqual({ ok: true, variableId: 'V:1', name: 'color/primary' });
    expect(v).toMatchObject({
      name: 'color/primary',
      description: 'The brand colour',
      scopes: ['FRAME_FILL', 'SHAPE_FILL'],
      hiddenFromPublishing: true,
    });
  });

  it('leaves every field it is not given as it was, and writes none that already hold', async () => {
    const writes: string[] = [];
    const v = new Proxy(makeVariable(), {
      set: (t, k, val) => {
        writes.push(String(k));
        return Reflect.set(t, k, val);
      },
    });
    await createUpdateVariableHandler(fakeFigma(v))({ variableId: 'V:1', description: 'd' });
    await createUpdateVariableHandler(fakeFigma(v))({
      variableId: 'V:1',
      name: 'color/brand',
      scopes: ['ALL_SCOPES'],
      hiddenFromPublishing: false,
    });
    expect(writes).toEqual(['description']);
  });

  it('says when Figma stored the description differently, and compares scopes as a set', async () => {
    let description = '';
    let scopes = ['ALL_SCOPES'];
    const v = makeVariable();
    Object.defineProperty(v, 'description', {
      get: () => description,
      set: (x: string) => {
        description = x.trim();
      },
    });
    Object.defineProperty(v, 'scopes', {
      get: () => scopes,
      set: (x: string[]) => {
        scopes = x.toSorted();
      },
    });
    const result = (await createUpdateVariableHandler(fakeFigma(v))({
      variableId: 'V:1',
      description: '  padded  ',
      scopes: ['STROKE_COLOR', 'FRAME_FILL'],
    })) as VariableResult;
    expect(result.adjusted).toMatch(/^description was stored as "padded" \(Figma trims/);
    expect(scopes).toEqual(['FRAME_FILL', 'STROKE_COLOR']);
  });

  it('puts back what it wrote when Figma refuses a later field, and names the scopes the type takes', async () => {
    const v = makeVariable({ name: 'color/brand' });
    Object.defineProperty(v, 'scopes', {
      enumerable: true,
      get: () => ['ALL_SCOPES'],
      set: () => {
        throw new Error('in set_scopes: Invalid scope for this variable type');
      },
    });
    await expect(
      createUpdateVariableHandler(fakeFigma(v))({
        variableId: 'V:1',
        name: 'color/primary',
        description: 'never written',
        scopes: ['GAP'],
      }),
    ).rejects.toThrow(
      'in set_scopes: Invalid scope for this variable type (update_variable: a COLOR variable takes ' +
        'ALL_SCOPES / ALL_FILLS / FRAME_FILL / SHAPE_FILL / TEXT_FILL / STROKE_COLOR / EFFECT_COLOR, ' +
        'or [] to be offered nowhere)',
    );
    expect([v.name, v.description]).toEqual(['color/brand', '']);
  });

  it('says a BOOLEAN takes only ALL_SCOPES, and an EASING none', async () => {
    for (const [type, figmaMessage, hint] of [
      ['BOOLEAN', 'Invalid scope for this variable type', 'a BOOLEAN variable takes ALL_SCOPES)'],
      ['EASING', 'Cannot set scopes on this variable type', 'an EASING variable takes no scopes)'],
    ] as const) {
      const v = makeVariable({ resolvedType: type });
      Object.defineProperty(v, 'scopes', {
        get: () => ['ALL_SCOPES'],
        set: () => {
          throw new Error(`in set_scopes: ${figmaMessage}`);
        },
      });
      await expect(
        createUpdateVariableHandler(fakeFigma(v))({ variableId: 'V:1', scopes: [] }),
      ).rejects.toThrow(hint);
    }
  });

  it("explains Figma's refusal of a library variable, and only that one", async () => {
    const remote = makeVariable({ remote: true });
    Object.defineProperty(remote, 'description', {
      get: () => '',
      set: () => {
        throw new Error(
          'in set_description: Cannot write to internal and read-only node. Are you trying to modify a remote style or component?',
        );
      },
    });
    await expect(
      createUpdateVariableHandler(fakeFigma(remote))({ variableId: 'V:1', description: 'x' }),
    ).rejects.toThrow(
      /^in set_description: Cannot write to internal and read-only node\. .* \(update_variable: variable V:1 "color\/brand" comes from a library, and a library variable is edited in the library file that publishes it\)$/,
    );
    // A local variable's refusal passes through untouched.
    const local = makeVariable();
    Object.defineProperty(local, 'name', {
      get: () => 'color/brand',
      set: () => {
        throw new Error('in set_name: duplicate variable name');
      },
    });
    await expect(
      createUpdateVariableHandler(fakeFigma(local))({ variableId: 'V:1', name: 'taken' }),
    ).rejects.toThrow(/^in set_name: duplicate variable name$/);
  });

  it('checks its arguments before looking the variable up', async () => {
    const run = (params: unknown) => createUpdateVariableHandler(fakeFigma(null))(params);
    await expect(run({})).rejects.toThrow('update_variable: variableId must be a string');
    await expect(run({ variableId: 'V:1', name: '' })).rejects.toThrow(
      'name must be a non-empty string',
    );
    await expect(run({ variableId: 'V:1', description: 1 })).rejects.toThrow(
      'description must be a string',
    );
    await expect(run({ variableId: 'V:1', scopes: 'GAP' })).rejects.toThrow(
      'scopes must be an array of scope names',
    );
    await expect(run({ variableId: 'V:1', hiddenFromPublishing: 'yes' })).rejects.toThrow(
      'hiddenFromPublishing must be a boolean',
    );
    await expect(run({ variableId: 'V:9' })).rejects.toThrow(
      'update_variable: variable V:9 not found',
    );
  });
});
