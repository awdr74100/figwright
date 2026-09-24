import type { VariableResult } from '@figwright/shared';
import { describe, expect, it, vi } from 'vitest';

import { createSetVariableValueHandler } from '../../src/handlers/set-variable-value.js';

const fakeFigma = (variable: unknown): typeof figma =>
  ({ variables: { getVariableByIdAsync: async () => variable } }) as unknown as typeof figma;

describe('set_variable_value handler', () => {
  it('sets a color value for a mode (RGB normalised to RGBA pass-through)', async () => {
    const setValueForMode = vi.fn<() => void>();
    const variable = { id: 'V:0', name: 'color/primary', setValueForMode };
    const handler = createSetVariableValueHandler(fakeFigma(variable));
    const result = (await handler({
      variableId: 'V:0',
      modeId: 'M:0',
      value: { r: 1, g: 0, b: 0, a: 1 },
    })) as VariableResult;

    expect(setValueForMode).toHaveBeenCalledWith('M:0', { r: 1, g: 0, b: 0, a: 1 });
    expect(result).toEqual({ ok: true, variableId: 'V:0', name: 'color/primary' });
  });

  it('converts a VARIABLE_ALIAS value', async () => {
    const setValueForMode = vi.fn<() => void>();
    const variable = { id: 'V:0', name: 'x', setValueForMode };
    const handler = createSetVariableValueHandler(fakeFigma(variable));
    await handler({
      variableId: 'V:0',
      modeId: 'M:0',
      value: { type: 'VARIABLE_ALIAS', id: 'V:9' },
    });
    expect(setValueForMode).toHaveBeenCalledWith('M:0', { type: 'VARIABLE_ALIAS', id: 'V:9' });
  });

  // Some MCP clients stringify the schema-untyped `value` in transit; the handler realigns it to the
  // variable's resolvedType so Figma's setValueForMode does not reject every non-STRING variable.
  it('coerces a stringified value back to the variable resolvedType', async () => {
    const cases: { resolvedType: string; raw: unknown; expected: unknown }[] = [
      { resolvedType: 'FLOAT', raw: '42', expected: 42 },
      { resolvedType: 'BOOLEAN', raw: 'true', expected: true },
      { resolvedType: 'BOOLEAN', raw: 'false', expected: false },
      {
        resolvedType: 'COLOR',
        raw: '{"r":0.2,"g":0.5,"b":1,"a":1}',
        expected: { r: 0.2, g: 0.5, b: 1, a: 1 },
      },
      { resolvedType: 'STRING', raw: 'hello', expected: 'hello' },
    ];
    for (const { resolvedType, raw, expected } of cases) {
      const setValueForMode = vi.fn<() => void>();
      const handler = createSetVariableValueHandler(
        fakeFigma({ id: 'V:0', name: 'x', resolvedType, setValueForMode }),
      );
      // eslint-disable-next-line no-await-in-loop -- small fixed table, sequential is fine
      await handler({ variableId: 'V:0', modeId: 'M:0', value: raw });
      expect(setValueForMode).toHaveBeenCalledWith('M:0', expected);
    }
  });

  // Regression for the go-style bug where a FLOAT "parser" strips alias objects: our coerce only
  // touches strings, so an alias to a FLOAT variable must pass through untouched (not NaN'd/stripped).
  it('passes a VARIABLE_ALIAS through for a FLOAT variable (not coerced to a number)', async () => {
    const setValueForMode = vi.fn<() => void>();
    const handler = createSetVariableValueHandler(
      fakeFigma({ id: 'V:0', name: 'radius/md', resolvedType: 'FLOAT', setValueForMode }),
    );
    await handler({
      variableId: 'V:0',
      modeId: 'M:0',
      value: { type: 'VARIABLE_ALIAS', id: 'V:9' },
    });
    expect(setValueForMode).toHaveBeenCalledWith('M:0', { type: 'VARIABLE_ALIAS', id: 'V:9' });
  });

  // The same go#22 alias, but stringified in transit (the client that stringifies COLOR's RGBA does
  // it to alias objects too). The FLOAT branch must JSON.parse it back rather than Number()→NaN it.
  it('parses a stringified VARIABLE_ALIAS back for a FLOAT variable', async () => {
    const setValueForMode = vi.fn<() => void>();
    const handler = createSetVariableValueHandler(
      fakeFigma({ id: 'V:0', name: 'radius/md', resolvedType: 'FLOAT', setValueForMode }),
    );
    await handler({
      variableId: 'V:0',
      modeId: 'M:0',
      value: '{"type":"VARIABLE_ALIAS","id":"V:9"}',
    });
    expect(setValueForMode).toHaveBeenCalledWith('M:0', { type: 'VARIABLE_ALIAS', id: 'V:9' });
  });

  // An EASING curve is an object with a `type` but no `id`. Before 1.133 the converter treated every
  // non-color object as an alias, which turned this into { type: 'VARIABLE_ALIAS', id: undefined }.
  // Real Figma rejects writing EASING/TIMING today, so this covers the conversion only — the value
  // reaching setValueForMode intact is what we control; whether Figma accepts it is not.
  it('passes an EASING curve through instead of mangling it into an alias', async () => {
    const setValueForMode = vi.fn<() => void>();
    const handler = createSetVariableValueHandler(
      fakeFigma({ id: 'V:0', name: 'motion/enter', resolvedType: 'EASING', setValueForMode }),
    );
    await handler({
      variableId: 'V:0',
      modeId: 'M:0',
      value: { type: 'CUSTOM_SPRING', easingFunctionSpring: { bounce: 0.4 } },
    });
    expect(setValueForMode).toHaveBeenCalledWith('M:0', {
      type: 'CUSTOM_SPRING',
      easingFunctionSpring: { bounce: 0.4 },
    });
  });

  it('coerces a stringified TIMING value to a number, like FLOAT', async () => {
    const setValueForMode = vi.fn<() => void>();
    const handler = createSetVariableValueHandler(
      fakeFigma({ id: 'V:0', name: 'motion/duration', resolvedType: 'TIMING', setValueForMode }),
    );
    await handler({ variableId: 'V:0', modeId: 'M:0', value: '250' });
    expect(setValueForMode).toHaveBeenCalledWith('M:0', 250);
  });

  it('rejects a stringified FLOAT that is not a number', async () => {
    const variable = {
      id: 'V:0',
      name: 'x',
      resolvedType: 'FLOAT',
      setValueForMode: vi.fn<() => void>(),
    };
    await expect(
      createSetVariableValueHandler(fakeFigma(variable))({
        variableId: 'V:0',
        modeId: 'M:0',
        value: 'abc',
      }),
    ).rejects.toThrow(/not a number/);
  });

  it('throws when variable missing or input bad', async () => {
    await expect(
      createSetVariableValueHandler(fakeFigma(null))({
        variableId: 'V:9',
        modeId: 'M:0',
        value: 1,
      }),
    ).rejects.toThrow(/not found/);
    await expect(
      createSetVariableValueHandler(fakeFigma(null))({ variableId: 'V:0', modeId: 'M:0' }),
    ).rejects.toThrow(/value is required/);
  });

  // plugin-typings 1.139: a colour and its opacity authored separately, with an alias on at least
  // one half. Each half keeps the form it was authored in — flattening either one would throw away
  // the reference the designer made.
  it('converts a composed color, keeping each half as authored', async () => {
    const setValueForMode = vi.fn<() => void>();
    const handler = createSetVariableValueHandler(
      fakeFigma({ id: 'V:0', name: 'color/overlay', resolvedType: 'COLOR', setValueForMode }),
    );

    await handler({
      variableId: 'V:0',
      modeId: 'M:0',
      // `hex` is what get_variable_defs adds for the agent's convenience; a value round-tripped
      // straight back must not carry it on to Figma, which takes RGBA channels only.
      value: {
        color: { r: 1, g: 0, b: 0, a: 1, hex: '#FF0000' },
        opacity: { type: 'VARIABLE_ALIAS', id: 'V:9' },
      },
    });
    expect(setValueForMode).toHaveBeenCalledWith('M:0', {
      color: { r: 1, g: 0, b: 0, a: 1 },
      opacity: { type: 'VARIABLE_ALIAS', id: 'V:9' },
    });

    await handler({
      variableId: 'V:0',
      modeId: 'M:1',
      value: { color: { type: 'VARIABLE_ALIAS', id: 'V:brand' }, opacity: 0.5 },
    });
    expect(setValueForMode).toHaveBeenLastCalledWith('M:1', {
      color: { type: 'VARIABLE_ALIAS', id: 'V:brand' },
      opacity: 0.5,
    });
  });

  it('survives a composed color stringified in transit', async () => {
    const setValueForMode = vi.fn<() => void>();
    const handler = createSetVariableValueHandler(
      fakeFigma({ id: 'V:0', name: 'color/overlay', resolvedType: 'COLOR', setValueForMode }),
    );
    await handler({
      variableId: 'V:0',
      modeId: 'M:0',
      value: JSON.stringify({
        color: { type: 'VARIABLE_ALIAS', id: 'V:brand' },
        opacity: 0.5,
      }),
    });
    expect(setValueForMode).toHaveBeenCalledWith('M:0', {
      color: { type: 'VARIABLE_ALIAS', id: 'V:brand' },
      opacity: 0.5,
    });
  });

  // Figma's type admits the pair only when one half is an alias; a concrete colour at a concrete
  // opacity is just an RGBA. Saying so here names the fix, where Figma would only refuse.
  it('refuses a composed color with no alias on either half', async () => {
    const setValueForMode = vi.fn<() => void>();
    const handler = createSetVariableValueHandler(
      fakeFigma({ id: 'V:0', name: 'color/overlay', resolvedType: 'COLOR', setValueForMode }),
    );
    await expect(
      handler({
        variableId: 'V:0',
        modeId: 'M:0',
        value: { color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 0.5 },
      }),
    ).rejects.toThrow(/at least one of color \/ opacity/);
    expect(setValueForMode).not.toHaveBeenCalled();
  });

  // The tool schema's union members are loose objects, so unknown keys survive validation and a
  // malformed RGBA can reach the converter still carrying them. Two things keep it on the colour
  // path: the composed branch demands *both* of its keys, and it is tried after the RGBA one. This
  // covers the second — with both stray keys present, only the ordering is left to decide, and the
  // composed branch would reach into `color` and throw on a non-object.
  it('still reads a color carrying stray composed-color keys as a color', async () => {
    const setValueForMode = vi.fn<() => void>();
    const handler = createSetVariableValueHandler(
      fakeFigma({ id: 'V:0', name: 'color/primary', resolvedType: 'COLOR', setValueForMode }),
    );
    await handler({
      variableId: 'V:0',
      modeId: 'M:0',
      value: { r: 1, g: 0, b: 0, a: 1, color: 'not-an-object', opacity: 0.5 },
    });
    expect(setValueForMode).toHaveBeenCalledWith('M:0', { r: 1, g: 0, b: 0, a: 1 });
  });
});
