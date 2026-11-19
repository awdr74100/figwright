import type { VariableResult } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import { createSetVariableCodeSyntaxHandler } from '../../src/handlers/set-variable-code-syntax.js';

/** A fake Variable whose set/remove mutate the backing codeSyntax record like the real API. */
const fakeVariable = (initial: Record<string, string> = {}): Record<string, unknown> => {
  const codeSyntax: Record<string, string> = { ...initial };
  return {
    id: 'V:1',
    name: 'color/primary',
    codeSyntax,
    setVariableCodeSyntax: (platform: string, value: string) => {
      codeSyntax[platform] = value;
    },
    removeVariableCodeSyntax: (platform: string) => {
      delete codeSyntax[platform];
    },
  };
};

const fakeFigma = (variable: unknown): typeof figma =>
  ({
    variables: {
      getVariableByIdAsync: async (id: string) => (id === 'V:1' ? variable : null),
    },
  }) as unknown as typeof figma;

describe('set_variable_code_syntax handler', () => {
  it('sets declarations per platform and echoes the result', async () => {
    const variable = fakeVariable();
    const handler = createSetVariableCodeSyntaxHandler(fakeFigma(variable));
    const result = (await handler({
      variableId: 'V:1',
      codeSyntax: { WEB: '--color-primary', iOS: 'ColorPrimary' },
    })) as VariableResult;

    expect(result).toEqual({
      ok: true,
      variableId: 'V:1',
      name: 'color/primary',
      codeSyntax: { WEB: '--color-primary', iOS: 'ColorPrimary' },
    });
  });

  it('null removes a declaration, omitted platforms are untouched', async () => {
    const variable = fakeVariable({ WEB: '--old', ANDROID: 'color_primary' });
    const handler = createSetVariableCodeSyntaxHandler(fakeFigma(variable));
    const result = (await handler({
      variableId: 'V:1',
      codeSyntax: { WEB: null },
    })) as VariableResult;

    // WEB removed, ANDROID untouched
    expect(result.codeSyntax).toEqual({ ANDROID: 'color_primary' });
  });

  it('omits the codeSyntax echo when the last declaration is removed', async () => {
    const variable = fakeVariable({ WEB: '--old' });
    const handler = createSetVariableCodeSyntaxHandler(fakeFigma(variable));
    const result = (await handler({
      variableId: 'V:1',
      codeSyntax: { WEB: null },
    })) as VariableResult;

    expect(result).toEqual({ ok: true, variableId: 'V:1', name: 'color/primary' });
  });

  it('throws on missing variable, unknown platform, empty object, or empty-string name', async () => {
    const handler = createSetVariableCodeSyntaxHandler(fakeFigma(fakeVariable()));
    await expect(handler({ variableId: 'V:9', codeSyntax: { WEB: '--x' } })).rejects.toThrow(
      /V:9 not found/,
    );
    await expect(handler({ variableId: 'V:1', codeSyntax: { web: '--x' } })).rejects.toThrow(
      /unknown platform "web"/,
    );
    await expect(handler({ variableId: 'V:1', codeSyntax: {} })).rejects.toThrow(
      /at least one platform/,
    );
    // '' is an ambiguous half-removal (the read side filters it out) — require null to remove
    await expect(handler({ variableId: 'V:1', codeSyntax: { WEB: '' } })).rejects.toThrow(
      /non-empty string, or null/,
    );
    await expect(handler({ variableId: 'V:1' })).rejects.toThrow(/codeSyntax/);
    await expect(handler({ codeSyntax: { WEB: '--x' } })).rejects.toThrow(/variableId/);
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
      createSetVariableCodeSyntaxHandler({
        variables: { getVariableByIdAsync: async () => v },
      } as unknown as typeof figma)({ variableId: 'V:1', codeSyntax: { WEB: '--x' } });
    await expect(
      run(
        refusing(
          true,
          'in set_name: Cannot write to internal and read-only node. Are you trying to modify a remote style or component?',
        ),
      ),
    ).rejects.toThrow(
      /read-only node\. Are you trying to modify a remote style or component\? \(set_variable_code_syntax: variable V:1 "space\/200" comes from a library, and a library variable is edited in the library file that publishes it\)$/,
    );
    await expect(run(refusing(false, 'in set_name: invalid variable name'))).rejects.toThrow(
      /^in set_name: invalid variable name$/,
    );
  });

  // setVariableCodeSyntax on a library variable says "No node found" (measured), not read-only.
  it('explains the "No node found" Figma gives for a library variable, and only for one', async () => {
    const v = (remote: boolean): Record<string, unknown> => ({
      id: 'V:1',
      name: 'Space/200',
      resolvedType: 'FLOAT',
      remote,
      codeSyntax: {},
      setVariableCodeSyntax: () => {
        throw new Error('in setVariableCodeSyntax: No node found');
      },
    });
    const run = (variable: unknown) =>
      createSetVariableCodeSyntaxHandler({
        variables: { getVariableByIdAsync: async () => variable },
      } as unknown as typeof figma)({ variableId: 'V:1', codeSyntax: { WEB: '--x' } });
    await expect(run(v(true))).rejects.toThrow(
      /^in setVariableCodeSyntax: No node found \(set_variable_code_syntax: variable V:1 "Space\/200" comes from a library/,
    );
    await expect(run(v(false))).rejects.toThrow(/^in setVariableCodeSyntax: No node found$/);
  });
});
