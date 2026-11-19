import type { VariableResult } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import { createRenameVariableHandler } from '../../src/handlers/rename-variable.js';

const fakeFigma = (variable: unknown): typeof figma =>
  ({
    variables: { getVariableByIdAsync: async () => variable },
  }) as unknown as typeof figma;

describe('rename_variable handler', () => {
  it('renames the variable', async () => {
    const variable = { id: 'V:0', name: 'color/primary' };
    const result = (await createRenameVariableHandler(fakeFigma(variable))({
      variableId: 'V:0',
      name: 'color/brand',
    })) as VariableResult;

    expect(variable.name).toBe('color/brand');
    expect(result).toEqual({ ok: true, variableId: 'V:0', name: 'color/brand' });
  });

  it('throws on missing variable or bad input', async () => {
    await expect(
      createRenameVariableHandler(fakeFigma(null))({ variableId: 'V:9', name: 'x' }),
    ).rejects.toThrow(/not found/);
    await expect(
      createRenameVariableHandler(fakeFigma({ id: 'V:0', name: 'a' }))({
        variableId: 'V:0',
        name: '',
      }),
    ).rejects.toThrow(/name/);
    await expect(
      createRenameVariableHandler(fakeFigma({ id: 'V:0', name: 'a' }))({ name: 'x' }),
    ).rejects.toThrow(/variableId/);
  });

  // Figma's refusal of a library variable names "a remote style or component"; the line added says
  // what the variable is and where it is edited. A local variable's refusal passes through as is.
  it("explains Figma's refusal of a library variable, and leaves every other refusal as it is", async () => {
    const refusing = (remote: boolean, message: string): Record<string, unknown> => {
      const fail = (): never => {
        throw new Error(message);
      };
      const v: Record<string, unknown> = {
        id: 'V:1',
        resolvedType: 'FLOAT',
        remote,
        codeSyntax: {},
        setVariableCodeSyntax: fail,
        removeVariableCodeSyntax: fail,
      };
      Object.defineProperty(v, 'name', { get: () => 'space/200', set: fail });
      return v;
    };
    const run = (v: unknown) =>
      createRenameVariableHandler({
        variables: { getVariableByIdAsync: async () => v },
      } as unknown as typeof figma)({ variableId: 'V:1', name: 'other' });
    await expect(
      run(
        refusing(
          true,
          'in set_name: Cannot write to internal and read-only node. Are you trying to modify a remote style or component?',
        ),
      ),
    ).rejects.toThrow(
      /read-only node\. Are you trying to modify a remote style or component\? \(rename_variable: variable V:1 "space\/200" comes from a library, and a library variable is edited in the library file that publishes it\)$/,
    );
    await expect(run(refusing(false, 'in set_name: invalid variable name'))).rejects.toThrow(
      /^in set_name: invalid variable name$/,
    );
  });
});
