import type { StyleResult } from '@figwright/shared';
import { describe, expect, it, vi } from 'vitest';

import { createUpdateTextStyleHandler } from '../../src/handlers/update-text-style.js';

const fakeFigma = (
  style: Record<string, unknown> | null,
  variables: Record<string, unknown> = {},
): { figma: typeof figma; loaded: FontName[]; bound: [string, unknown][] } => {
  const loaded: FontName[] = [];
  const bound: [string, unknown][] = [];
  if (style !== null) {
    style.setBoundVariable = (field: string, variable: unknown) => bound.push([field, variable]);
  }
  const figmaCtx = {
    getStyleByIdAsync: async () => style,
    variables: { getVariableByIdAsync: async (id: string) => variables[id] ?? null },
    loadFontAsync: vi.fn<(fn: FontName) => Promise<void>>(async (fn: FontName) => {
      loaded.push(fn);
    }),
  } as unknown as typeof figma;
  return { figma: figmaCtx, loaded, bound };
};

/** A style whose link setter stores something other than what it was sent, as Figma might. */
const normalizingLinks = (target: Record<string, unknown>): void => {
  let stored: { uri: string }[] = [];
  Object.defineProperty(target, 'documentationLinks', {
    enumerable: true,
    get: () => stored,
    set: (v: { uri: string }[]) => {
      stored = v.map(l => ({ uri: l.uri.toLowerCase() }));
    },
  });
};

describe('update_text_style handler', () => {
  it("assigns a variable font's axis values onto the style", async () => {
    const style: Record<string, unknown> = {
      id: 'S:0',
      type: 'TEXT',
      name: 'Body',
      fontName: { family: 'Inter', style: 'Regular' },
    };
    const { figma: f, loaded } = fakeFigma(style);
    await createUpdateTextStyleHandler(f)({
      styleId: 'S:0',
      fontName: { family: 'Inter', style: 'Regular', variationSettings: { wght: 300 } },
    });
    expect(style.fontName).toEqual({
      family: 'Inter',
      style: 'Regular',
      variationSettings: { wght: 300 },
    });
    expect(loaded[0]).toEqual({
      family: 'Inter',
      style: 'Regular',
      variationSettings: { wght: 300 },
    });
  });

  it('updates given fields (loading a new font first) and leaves omitted ones unchanged', async () => {
    const style: Record<string, unknown> = {
      id: 'S:0',
      type: 'TEXT',
      name: 'old',
      fontName: { family: 'Inter', style: 'Regular' },
      fontSize: 12,
      lineHeight: { unit: 'AUTO' },
      letterSpacing: { unit: 'PIXELS', value: 0 },
      description: 'keep',
    };
    const { figma: f, loaded } = fakeFigma(style);
    const result = (await createUpdateTextStyleHandler(f)({
      styleId: 'S:0',
      name: 'Heading/H1',
      fontName: { family: 'Inter', style: 'Bold' },
      fontSize: 32,
      lineHeight: { unit: 'PERCENT', value: 120 },
    })) as StyleResult;

    // The new font before assigning it, then the style's now-current face before the typography
    // writes. loadFontAsync is cached, so the repeat is free.
    expect(loaded).toEqual([
      { family: 'Inter', style: 'Bold' },
      { family: 'Inter', style: 'Bold' },
    ]);
    expect(style.name).toBe('Heading/H1');
    expect(style.fontName).toEqual({ family: 'Inter', style: 'Bold' });
    expect(style.fontSize).toBe(32);
    expect(style.lineHeight).toEqual({ unit: 'PERCENT', value: 120 });
    expect(style.letterSpacing).toEqual({ unit: 'PIXELS', value: 0 }); // omitted → unchanged
    expect(style.description).toBe('keep'); // omitted → unchanged
    expect(result).toEqual({ ok: true, styleId: 'S:0', name: 'Heading/H1' });
  });

  it("updates textWrapStyle after loading the style's font, and leaves it alone when omitted", async () => {
    // Live Figma rejects this one against an unloaded font, unlike the numeric fields — it writes
    // through to the style's text runs. The font is loaded even though it is not changing.
    const style: Record<string, unknown> = {
      id: 'S:0',
      type: 'TEXT',
      name: 'Body',
      fontName: { family: 'Inter', style: 'Regular' },
      textWrapStyle: 'AUTO',
    };
    const { figma: f, loaded } = fakeFigma(style);
    await createUpdateTextStyleHandler(f)({ styleId: 'S:0', textWrapStyle: 'PRETTY' });
    expect(style.textWrapStyle).toBe('PRETTY');
    expect(loaded).toEqual([{ family: 'Inter', style: 'Regular' }]);

    await createUpdateTextStyleHandler(f)({ styleId: 'S:0', fontSize: 18 });
    expect(style.textWrapStyle).toBe('PRETTY'); // omitted → unchanged
  });

  // This test used to assert the opposite — that a size-only update loads nothing, on the
  // reasoning that changing a number "touches no glyphs". Live Figma disagrees: it answers
  // `in set_fontSize: Cannot write to node with unloaded font "Inter Regular"`. Since nothing
  // loads a font just by reading a style, that made update_text_style fail on any style the caller
  // had not also re-fonted in the same session — which is most of them.
  it("loads the style's own font even for a numeric-only update (fontName omitted)", async () => {
    const style: Record<string, unknown> = {
      id: 'S:0',
      type: 'TEXT',
      name: 'x',
      fontName: { family: 'Inter', style: 'Regular' },
      fontSize: 12,
    };
    const { figma: f, loaded } = fakeFigma(style);
    await createUpdateTextStyleHandler(f)({ styleId: 'S:0', fontSize: 16 });
    expect(loaded).toEqual([{ family: 'Inter', style: 'Regular' }]);
    expect(style.fontSize).toBe(16);
  });

  it('throws when the style is missing or not a text style', async () => {
    await expect(
      createUpdateTextStyleHandler(fakeFigma(null).figma)({ styleId: 'S:9' }),
    ).rejects.toThrow(/not found/);
    await expect(
      createUpdateTextStyleHandler(fakeFigma({ id: 'S:0', type: 'PAINT' }).figma)({
        styleId: 'S:0',
      }),
    ).rejects.toThrow(/not found/);
    await expect(createUpdateTextStyleHandler(fakeFigma(null).figma)({})).rejects.toThrow(
      /styleId/,
    );
  });

  it('binds typography fields, and unbinds one passed as null', async () => {
    const variable = { id: 'V:1', name: 'size/lg', resolvedType: 'FLOAT', valuesByMode: {} };
    const style: Record<string, unknown> = {
      id: 'S:0',
      type: 'TEXT',
      name: 'Body',
      fontName: { family: 'Inter', style: 'Regular' },
    };
    const { figma: f, bound } = fakeFigma(style, { 'V:1': variable });
    await createUpdateTextStyleHandler(f)({
      styleId: 'S:0',
      boundVariables: { fontSize: 'V:1', lineHeight: null },
    });
    // A text style write is a patch, so omission cannot mean "unbind" the way it does for the
    // whole-array paints and effects — null is how a caller says it.
    expect(bound).toEqual([
      ['fontSize', variable],
      ['lineHeight', null],
    ]);
  });

  it('applies bindings after literals, so a bound field wins over one set in the same call', async () => {
    const variable = { id: 'V:1', name: 'size/lg', resolvedType: 'FLOAT', valuesByMode: {} };
    const style: Record<string, unknown> = {
      id: 'S:0',
      type: 'TEXT',
      name: 'Body',
      fontName: { family: 'Inter', style: 'Regular' },
      fontSize: 12,
    };
    const { figma: f, bound } = fakeFigma(style, { 'V:1': variable });
    await createUpdateTextStyleHandler(f)({
      styleId: 'S:0',
      fontSize: 99,
      boundVariables: { fontSize: 'V:1' },
    });
    expect(style.fontSize).toBe(99); // the literal landed first…
    expect(bound).toEqual([['fontSize', variable]]); // …and the binding then took over the field
  });

  it('leaves the style untouched when a binding cannot be resolved', async () => {
    const style: Record<string, unknown> = {
      id: 'S:0',
      type: 'TEXT',
      name: 'Body',
      fontName: { family: 'Inter', style: 'Regular' },
    };
    const { figma: f, bound } = fakeFigma(style);
    await expect(
      createUpdateTextStyleHandler(f)({ styleId: 'S:0', boundVariables: { fontSize: 'V:gone' } }),
    ).rejects.toThrow('update_text_style: variable V:gone not found');
    expect(bound).toEqual([]);
  });

  // Measured on main: the style was renamed, resized and re-described before the binding failed.
  it('leaves every field alone when a binding cannot be resolved', async () => {
    const style: Record<string, unknown> = {
      id: 'S:0',
      type: 'TEXT',
      name: 'Body',
      description: 'd',
      fontName: { family: 'Inter', style: 'Regular' },
      fontSize: 12,
    };
    const { figma: f, bound } = fakeFigma(style);
    await expect(
      createUpdateTextStyleHandler(f)({
        styleId: 'S:0',
        name: 'renamed',
        description: 'changed',
        fontSize: 31,
        boundVariables: { fontSize: 'V:gone' },
      }),
    ).rejects.toThrow('update_text_style: variable V:gone not found');
    expect([style.name, style.description, style.fontSize]).toEqual(['Body', 'd', 12]);
    expect(bound).toEqual([]);
  });

  it('leaves every field alone when the new font does not load', async () => {
    const style: Record<string, unknown> = {
      id: 'S:0',
      type: 'TEXT',
      name: 'Body',
      fontName: { family: 'Inter', style: 'Regular' },
      fontSize: 12,
    };
    const { figma: f } = fakeFigma(style);
    (
      f.loadFontAsync as unknown as {
        mockImplementation: (fn: (font: FontName) => Promise<void>) => void;
      }
    ).mockImplementation(async font => {
      if (font.family === 'Missing')
        throw new Error('The font "Missing Regular" could not be loaded');
    });
    await expect(
      createUpdateTextStyleHandler(f)({
        styleId: 'S:0',
        name: 'renamed',
        fontSize: 31,
        fontName: { family: 'Missing', style: 'Regular' },
      }),
    ).rejects.toThrow('could not be loaded');
    expect([style.name, style.fontName, style.fontSize]).toEqual([
      'Body',
      { family: 'Inter', style: 'Regular' },
      12,
    ]);
  });

  it('puts back what it wrote when Figma refuses a later write', async () => {
    const style: Record<string, unknown> = {
      id: 'S:0',
      type: 'TEXT',
      name: 'Body',
      description: 'd',
      fontName: { family: 'Inter', style: 'Regular' },
      fontSize: 12,
    };
    Object.defineProperty(style, 'lineHeight', {
      enumerable: true,
      get: () => ({ unit: 'AUTO' }),
      set: () => {
        throw new Error('in set_lineHeight: refused');
      },
    });
    const { figma: f } = fakeFigma(style);
    await expect(
      createUpdateTextStyleHandler(f)({
        styleId: 'S:0',
        name: 'renamed',
        fontSize: 31,
        lineHeight: { unit: 'PIXELS', value: 20 },
        description: 'changed',
      }),
    ).rejects.toThrow(/^in set_lineHeight: refused$/);
    expect([style.name, style.fontSize, style.description]).toEqual(['Body', 12, 'd']);
  });

  it('writes nothing at all when a font does not load or a binding cannot be resolved', async () => {
    const writes: string[] = [];
    const target: Record<string, unknown> = {
      id: 'S:0',
      type: 'TEXT',
      name: 'Body',
      description: 'd',
      fontName: { family: 'Inter', style: 'Regular' },
      fontSize: 12,
    };
    const style = new Proxy(target, {
      set: (t, key, value) => {
        if (key !== 'setBoundVariable') writes.push(String(key));
        return Reflect.set(t, key, value);
      },
    });
    const { figma: f, bound } = fakeFigma(style);
    await expect(
      createUpdateTextStyleHandler(f)({
        styleId: 'S:0',
        name: 'renamed',
        fontSize: 31,
        description: 'changed',
        boundVariables: { fontSize: 'V:gone' },
      }),
    ).rejects.toThrow('variable V:gone not found');
    (
      f.loadFontAsync as unknown as {
        mockImplementation: (fn: (font: FontName) => Promise<void>) => void;
      }
    ).mockImplementation(async font => {
      if (font.family === 'Missing') throw new Error('could not be loaded');
    });
    await expect(
      createUpdateTextStyleHandler(f)({
        styleId: 'S:0',
        name: 'renamed',
        fontName: { family: 'Missing', style: 'Regular' },
      }),
    ).rejects.toThrow('could not be loaded');
    expect(writes).toEqual([]);
    expect(bound).toEqual([]);
  });

  // A binding the failed call took off has to go back on, not just the literals around it.
  it('re-binds what a failed call unbound', async () => {
    const size = { id: 'V:1', name: 'size', resolvedType: 'FLOAT', valuesByMode: {} };
    const height = { id: 'V:2', name: 'height', resolvedType: 'FLOAT', valuesByMode: {} };
    const boundVariables: Record<string, { type: string; id: string } | undefined> = {
      fontSize: { type: 'VARIABLE_ALIAS', id: 'V:1' },
    };
    const style: Record<string, unknown> = {
      id: 'S:0',
      type: 'TEXT',
      name: 'Body',
      fontName: { family: 'Inter', style: 'Regular' },
      fontSize: 12,
      boundVariables,
    };
    const { figma: f } = fakeFigma(style, { 'V:1': size, 'V:2': height });
    style.setBoundVariable = (field: string, variable: { id: string } | null) => {
      if (field === 'lineHeight') throw new Error('in setBoundVariable: refused');
      boundVariables[field] =
        variable === null ? undefined : { type: 'VARIABLE_ALIAS', id: variable.id };
    };
    await expect(
      createUpdateTextStyleHandler(f)({
        styleId: 'S:0',
        name: 'renamed',
        boundVariables: { fontSize: null, lineHeight: 'V:2' },
      }),
    ).rejects.toThrow(/^in setBoundVariable: refused$/);
    expect(boundVariables.fontSize).toEqual({ type: 'VARIABLE_ALIAS', id: 'V:1' });
    expect(style.name).toBe('Body');
  });

  // Measured: a name or description writes with the style's face never loaded, while fontSize and
  // lineHeight in the same session are refused. So a style whose font cannot be loaded at all can
  // still be renamed and described — the unconditional load used to fail that call.
  it('renames and describes a style without loading its font', async () => {
    const style: Record<string, unknown> = {
      id: 'S:0',
      type: 'TEXT',
      name: 'Body',
      description: 'd',
      fontName: { family: 'Not Installed', style: 'Regular' },
      fontSize: 12,
    };
    const { figma: f, loaded } = fakeFigma(style);
    (
      f.loadFontAsync as unknown as {
        mockImplementation: (fn: (font: FontName) => Promise<void>) => void;
      }
    ).mockImplementation(async () => {
      throw new Error('The font "Not Installed Regular" could not be loaded');
    });
    const result = (await createUpdateTextStyleHandler(f)({
      styleId: 'S:0',
      name: 'Heading',
      description: 'updated',
    })) as StyleResult;
    expect(result).toEqual({ ok: true, styleId: 'S:0', name: 'Heading' });
    expect([style.name, style.description]).toEqual(['Heading', 'updated']);
    expect(loaded).toEqual([]);

    // Any typography still loads it first — and here, fails before anything is written.
    await expect(
      createUpdateTextStyleHandler(f)({ styleId: 'S:0', name: 'Other', fontSize: 14 }),
    ).rejects.toThrow('could not be loaded');
    expect([style.name, style.fontSize]).toEqual(['Heading', 12]);
  });

  // A failed rename of a style whose font cannot be loaded has only the name to put back, and must
  // not fail its restore on the font it never needed.
  it('puts a label back without loading a font it cannot load', async () => {
    const style: Record<string, unknown> = {
      id: 'S:0',
      type: 'TEXT',
      name: 'Body',
      fontName: { family: 'Not Installed', style: 'Regular' },
    };
    Object.defineProperty(style, 'description', {
      enumerable: true,
      get: () => 'd',
      set: () => {
        throw new Error('in set_description: refused');
      },
    });
    const { figma: f, loaded } = fakeFigma(style);
    (
      f.loadFontAsync as unknown as {
        mockImplementation: (fn: (font: FontName) => Promise<void>) => void;
      }
    ).mockImplementation(async () => {
      throw new Error('could not be loaded');
    });
    await expect(
      createUpdateTextStyleHandler(f)({ styleId: 'S:0', name: 'Heading', description: 'x' }),
    ).rejects.toThrow(/^in set_description: refused$/);
    expect(style.name).toBe('Body');
    expect(loaded).toEqual([]);
  });

  // Measured 2026-11-19: a literal written to a bound fontSize / lineHeight / letterSpacing /
  // paragraphSpacing takes the binding off. So a call that fails after such a write has a binding to
  // put back even though it never named boundVariables.
  it('re-binds a field a literal write unbound before the call failed', async () => {
    const size = { id: 'V:1', name: 'size', resolvedType: 'FLOAT', valuesByMode: {} };
    const boundVariables: Record<string, { type: string; id: string } | undefined> = {
      fontSize: { type: 'VARIABLE_ALIAS', id: 'V:1' },
    };
    const style: Record<string, unknown> = {
      id: 'S:0',
      type: 'TEXT',
      name: 'Body',
      fontName: { family: 'Inter', style: 'Regular' },
      boundVariables,
    };
    let fontSize = 21;
    Object.defineProperty(style, 'fontSize', {
      enumerable: true,
      get: () => fontSize,
      set: (value: number) => {
        fontSize = value;
        delete boundVariables.fontSize; // what Figma does to a bound field given a literal
      },
    });
    Object.defineProperty(style, 'lineHeight', {
      enumerable: true,
      get: () => ({ unit: 'AUTO' }),
      set: () => {
        throw new Error('in set_lineHeight: refused');
      },
    });
    const { figma: f } = fakeFigma(style, { 'V:1': size });
    style.setBoundVariable = (field: string, variable: { id: string } | null) => {
      boundVariables[field] =
        variable === null ? undefined : { type: 'VARIABLE_ALIAS', id: variable.id };
    };
    await expect(
      createUpdateTextStyleHandler(f)({
        styleId: 'S:0',
        fontSize: 30,
        lineHeight: { unit: 'PIXELS', value: 20 },
      }),
    ).rejects.toThrow(/^in set_lineHeight: refused$/);
    expect(boundVariables.fontSize).toEqual({ type: 'VARIABLE_ALIAS', id: 'V:1' });
  });

  // A link is not typography: a call that changes only it (and labels) loads no font, so a style
  // whose font cannot be loaded can still be given one.
  it('sets the documentation link without loading the font', async () => {
    const style: Record<string, unknown> = {
      id: 'S:0',
      type: 'TEXT',
      name: 'Body',
      fontName: { family: 'Not Installed', style: 'Regular' },
      documentationLinks: [],
    };
    const { figma: f, loaded } = fakeFigma(style);
    await createUpdateTextStyleHandler(f)({
      styleId: 'S:0',
      name: 'Heading',
      documentationLinks: [{ uri: 'https://sb.example.com/heading' }],
    });
    expect(style.documentationLinks).toEqual([{ uri: 'https://sb.example.com/heading' }]);
    expect(loaded).toEqual([]);
  });

  it('puts the link back when a later write fails', async () => {
    const style: Record<string, unknown> = {
      id: 'S:0',
      type: 'TEXT',
      name: 'Body',
      fontName: { family: 'Inter', style: 'Regular' },
      documentationLinks: [{ uri: 'https://old.com' }],
    };
    Object.defineProperty(style, 'fontSize', {
      enumerable: true,
      get: () => 12,
      set: () => {
        throw new Error('in set_fontSize: refused');
      },
    });
    const { figma: f } = fakeFigma(style);
    await expect(
      createUpdateTextStyleHandler(f)({
        styleId: 'S:0',
        fontSize: 30,
        documentationLinks: [{ uri: 'https://new.com' }],
      }),
    ).rejects.toThrow(/^in set_fontSize: refused$/);
    expect(style.documentationLinks).toEqual([{ uri: 'https://old.com' }]);
  });

  it('says in adjusted when the link was stored differently from what was sent', async () => {
    const style: Record<string, unknown> = {
      id: 'S:0',
      type: 'TEXT',
      name: 'Body',
      fontName: { family: 'Inter', style: 'Regular' },
    };
    normalizingLinks(style);
    const { figma: f } = fakeFigma(style);
    const result = await createUpdateTextStyleHandler(f)({
      styleId: 'S:0',
      documentationLinks: [{ uri: 'HTTPS://A.COM' }],
    });
    expect(result).toEqual({
      ok: true,
      styleId: 'S:0',
      name: 'Body',
      adjusted: 'documentationLinks were stored as ["https://a.com"]',
    });
  });

  // Putting a link back is not typography either: a refused label write after the link loads no
  // font on the way back, so a style whose font is not installed is still restored whole.
  it('puts a link back without loading the font', async () => {
    const style: Record<string, unknown> = {
      id: 'S:0',
      type: 'TEXT',
      fontName: { family: 'Not Installed', style: 'Regular' },
      documentationLinks: [{ uri: 'https://old.com' }],
    };
    Object.defineProperty(style, 'name', {
      enumerable: true,
      get: () => 'Body',
      set: () => {
        throw new Error('in set_name: refused');
      },
    });
    const { figma: f, loaded } = fakeFigma(style);
    await expect(
      createUpdateTextStyleHandler(f)({
        styleId: 'S:0',
        name: 'Heading',
        documentationLinks: [{ uri: 'https://new.com' }],
      }),
    ).rejects.toThrow(/^in set_name: refused$/);
    expect(style.documentationLinks).toEqual([{ uri: 'https://old.com' }]);
    expect(loaded).toEqual([]);
  });

  it('names a malformed link before it loads a font or looks the style up', async () => {
    const { figma: f, loaded } = fakeFigma(null);
    await expect(
      createUpdateTextStyleHandler(f)({
        styleId: 'S:0',
        fontName: { family: 'Not Installed', style: 'Regular' },
        documentationLinks: [{ uri: 'https://a.com' }, { uri: 'https://b.com' }],
      }),
    ).rejects.toThrow(
      "update_text_style: documentationLinks holds at most one link (Figma's limit)",
    );
    expect(loaded).toEqual([]);
  });
});
