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
});
