import { describe, expect, it, vi } from 'vitest';

import {
  toFigmaEffectsBound,
  toFigmaLayoutGridsBound,
  toFigmaPaintsBound,
} from '../../src/handlers/bindings.js';

// The write half of issue #164. Two measured facts shape every test here:
//
//  1. Figma accepts a binding embedded in a plain object literal — the only way to bind a gradient
//     stop, which has no setter — but that path validates almost nothing. An id matching no
//     variable, and a variable of the wrong resolved type, are both taken silently and then render
//     white. So the official setters are used wherever they exist, and the gradient stop is checked
//     here instead.
//  2. Writing an array back WITHOUT `boundVariables` clears whatever it was bound to, because Figma
//     replaces the whole array. That is the semantics these functions preserve — there is no
//     separate unbind path to test.

const VAR = (id: string, resolvedType = 'COLOR') => ({ id, name: `var/${id}`, resolvedType });

/** SetBoundVariableFor* return a NEW object; the fake records the call and marks the result. */
const fakeFigma = (variables: Record<string, unknown>) => {
  const ctx = {
    variables: {
      getVariableByIdAsync: vi.fn<(id: string) => Promise<unknown>>(
        async (id: string) => variables[id] ?? null,
      ),
      setBoundVariableForPaint: vi.fn<(p: object, f: string, v: { id: string }) => object>(
        (paint: object, field: string, variable: { id: string }) => ({
          ...paint,
          boundVariables: {
            ...(paint as { boundVariables?: object }).boundVariables,
            [field]: { type: 'VARIABLE_ALIAS', id: variable.id },
          },
        }),
      ),
      setBoundVariableForEffect: vi.fn<(e: object, f: string, v: { id: string }) => object>(
        (effect: object, field: string, variable: { id: string }) => ({
          ...effect,
          boundVariables: {
            ...(effect as { boundVariables?: object }).boundVariables,
            [field]: { type: 'VARIABLE_ALIAS', id: variable.id },
          },
        }),
      ),
      setBoundVariableForLayoutGrid: vi.fn<(g: object, f: string, v: { id: string }) => object>(
        (grid: object, field: string, variable: { id: string }) => ({
          ...grid,
          boundVariables: {
            ...(grid as { boundVariables?: object }).boundVariables,
            [field]: { type: 'VARIABLE_ALIAS', id: variable.id },
          },
        }),
      ),
    },
  };
  return ctx as unknown as typeof figma & { variables: typeof ctx.variables };
};

const solid = (over: Record<string, unknown> = {}) => ({
  type: 'SOLID' as const,
  visible: true,
  opacity: 1,
  color: { r: 1, g: 0, b: 0 },
  ...over,
});

const gradient = (stops: unknown[]) => ({
  type: 'GRADIENT_LINEAR' as const,
  visible: true,
  opacity: 1,
  gradientTransform: [
    [1, 0, 0],
    [0, 1, 0],
  ],
  gradientStops: stops,
});

const shadow = (over: Record<string, unknown> = {}) => ({
  type: 'DROP_SHADOW',
  visible: true,
  radius: 4,
  color: { r: 0, g: 0, b: 0, a: 0.2 },
  offset: { x: 0, y: 2 },
  spread: 0,
  ...over,
});

describe('toFigmaPaintsBound', () => {
  it('binds a solid paint through the official setter, not by embedding an alias', async () => {
    const ctx = fakeFigma({ 'V:1': VAR('V:1') });
    const out = await toFigmaPaintsBound(
      ctx,
      [solid({ boundVariables: { color: 'V:1' } })] as never,
      'set_fills',
    );
    expect(ctx.variables.setBoundVariableForPaint).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SOLID' }),
      'color',
      expect.objectContaining({ id: 'V:1' }),
    );
    expect(out[0]).toMatchObject({
      boundVariables: { color: { type: 'VARIABLE_ALIAS', id: 'V:1' } },
    });
  });

  it('leaves an unbound paint exactly as the plain converter produced it', async () => {
    const ctx = fakeFigma({});
    const out = await toFigmaPaintsBound(ctx, [solid()] as never, 'set_fills');
    expect(ctx.variables.setBoundVariableForPaint).not.toHaveBeenCalled();
    expect(ctx.variables.getVariableByIdAsync).not.toHaveBeenCalled();
    expect(out[0]).not.toHaveProperty('boundVariables');
  });

  it('binds a gradient stop by embedding the alias (Figma exposes no setter for one)', async () => {
    const ctx = fakeFigma({ 'V:1': VAR('V:1') });
    const out = (await toFigmaPaintsBound(
      ctx,
      [
        gradient([
          { position: 0, color: { r: 1, g: 1, b: 1, a: 1 }, boundVariables: { color: 'V:1' } },
          { position: 1, color: { r: 0, g: 0, b: 0, a: 1 } },
        ]),
      ] as never,
      'set_fills',
    )) as unknown as { gradientStops: { boundVariables?: unknown }[] }[];
    expect(ctx.variables.setBoundVariableForPaint).not.toHaveBeenCalled();
    expect(out[0]?.gradientStops[0]?.boundVariables).toEqual({
      color: { type: 'VARIABLE_ALIAS', id: 'V:1' },
    });
    expect(out[0]?.gradientStops[1]).not.toHaveProperty('boundVariables');
  });

  it('rejects a non-COLOR variable on a gradient stop, which Figma would accept silently', async () => {
    const ctx = fakeFigma({ 'V:n': VAR('V:n', 'FLOAT') });
    await expect(
      toFigmaPaintsBound(
        ctx,
        [
          gradient([
            { position: 0, color: { r: 1, g: 1, b: 1, a: 1 }, boundVariables: { color: 'V:n' } },
          ]),
        ] as never,
        'set_fills',
      ),
    ).rejects.toThrow(/gradient stop colour takes a COLOR variable; var\/V:n is FLOAT/);
  });

  it('rejects an id that resolves to no variable', async () => {
    const ctx = fakeFigma({});
    await expect(
      toFigmaPaintsBound(
        ctx,
        [solid({ boundVariables: { color: 'V:gone' } })] as never,
        'set_fills',
      ),
    ).rejects.toThrow('set_fills: variable V:gone not found');
  });

  it('resolves before binding anything, so a bad id in a later paint aborts the whole array', async () => {
    const ctx = fakeFigma({ 'V:1': VAR('V:1') });
    await expect(
      toFigmaPaintsBound(
        ctx,
        [
          solid({ boundVariables: { color: 'V:1' } }),
          solid({ boundVariables: { color: 'V:no' } }),
        ] as never,
        'set_fills',
      ),
    ).rejects.toThrow('variable V:no not found');
    // The good paint must not have been bound either — the caller assigns the returned array, so a
    // partial result would be a half-written node.
    expect(ctx.variables.setBoundVariableForPaint).not.toHaveBeenCalled();
  });

  it('looks each distinct variable up once, however many paints cite it', async () => {
    const ctx = fakeFigma({ 'V:1': VAR('V:1') });
    await toFigmaPaintsBound(
      ctx,
      [
        solid({ boundVariables: { color: 'V:1' } }),
        solid({ boundVariables: { color: 'V:1' } }),
        gradient([
          { position: 0, color: { r: 0, g: 0, b: 0, a: 1 }, boundVariables: { color: 'V:1' } },
        ]),
      ] as never,
      'set_fills',
    );
    expect(ctx.variables.getVariableByIdAsync).toHaveBeenCalledTimes(1);
  });
});

describe('toFigmaEffectsBound', () => {
  it('applies every bound field, chaining the new object each setter returns', async () => {
    const ctx = fakeFigma({ 'V:c': VAR('V:c'), 'V:n': VAR('V:n', 'FLOAT') });
    const out = await toFigmaEffectsBound(
      ctx,
      [shadow({ boundVariables: { color: 'V:c', radius: 'V:n' } })] as never,
      'set_effects',
    );
    expect(ctx.variables.setBoundVariableForEffect).toHaveBeenCalledTimes(2);
    // Chained, not applied to the original: both bindings survive on one object.
    expect(out[0]).toMatchObject({
      boundVariables: {
        color: { type: 'VARIABLE_ALIAS', id: 'V:c' },
        radius: { type: 'VARIABLE_ALIAS', id: 'V:n' },
      },
    });
  });

  it('passes the field through untranslated, so a newly bindable field needs no change here', async () => {
    const ctx = fakeFigma({ 'V:n': VAR('V:n', 'FLOAT') });
    await toFigmaEffectsBound(
      ctx,
      [shadow({ boundVariables: { offsetX: 'V:n' } })] as never,
      'set_effects',
    );
    expect(ctx.variables.setBoundVariableForEffect).toHaveBeenCalledWith(
      expect.anything(),
      'offsetX',
      expect.objectContaining({ id: 'V:n' }),
    );
  });

  it('rejects an unresolvable id before touching the setter', async () => {
    const ctx = fakeFigma({});
    await expect(
      toFigmaEffectsBound(
        ctx,
        [shadow({ boundVariables: { color: 'V:x' } })] as never,
        'set_effects',
      ),
    ).rejects.toThrow('set_effects: variable V:x not found');
    expect(ctx.variables.setBoundVariableForEffect).not.toHaveBeenCalled();
  });
});

describe('toFigmaLayoutGridsBound', () => {
  it('binds a grid field through the official setter', async () => {
    const ctx = fakeFigma({ 'V:n': VAR('V:n', 'FLOAT') });
    const out = await toFigmaLayoutGridsBound(
      ctx,
      [
        {
          pattern: 'COLUMNS',
          visible: true,
          count: 12,
          gutterSize: 16,
          alignment: 'STRETCH',
          boundVariables: { gutterSize: 'V:n' },
        },
      ] as never,
      'set_layout_grids',
    );
    expect(ctx.variables.setBoundVariableForLayoutGrid).toHaveBeenCalledWith(
      expect.objectContaining({ pattern: 'COLUMNS' }),
      'gutterSize',
      expect.objectContaining({ id: 'V:n' }),
    );
    expect(out[0]).toMatchObject({
      boundVariables: { gutterSize: { type: 'VARIABLE_ALIAS', id: 'V:n' } },
    });
  });

  it('binds on the uniform GRID pattern too', async () => {
    const ctx = fakeFigma({ 'V:n': VAR('V:n', 'FLOAT') });
    await toFigmaLayoutGridsBound(
      ctx,
      [
        {
          pattern: 'GRID',
          visible: true,
          sectionSize: 8,
          boundVariables: { sectionSize: 'V:n' },
        },
      ] as never,
      'set_layout_grids',
    );
    expect(ctx.variables.setBoundVariableForLayoutGrid).toHaveBeenCalledWith(
      expect.objectContaining({ pattern: 'GRID' }),
      'sectionSize',
      expect.anything(),
    );
  });
});
