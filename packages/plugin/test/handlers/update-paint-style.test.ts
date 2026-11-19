import type { StyleResult } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import { createUpdatePaintStyleHandler } from '../../src/handlers/update-paint-style.js';

const fakeFigma = (style: unknown, variables: Record<string, unknown> = {}): typeof figma =>
  ({
    getStyleByIdAsync: async () => style,
    variables: {
      getVariableByIdAsync: async (id: string) => variables[id] ?? null,
      setBoundVariableForPaint: (paint: object, field: string, v: { id: string }) => ({
        ...paint,
        boundVariables: { [field]: { type: 'VARIABLE_ALIAS', id: v.id } },
      }),
    },
  }) as unknown as typeof figma;

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

describe('update_paint_style handler', () => {
  it('updates name + paints of an existing paint style', async () => {
    const style = { id: 'S:0', type: 'PAINT', name: 'old', paints: [] as unknown, description: '' };
    const handler = createUpdatePaintStyleHandler(fakeFigma(style));
    const result = (await handler({
      styleId: 'S:0',
      name: 'new',
      paints: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 0, g: 1, b: 0 } }],
    })) as StyleResult;

    expect(style.name).toBe('new');
    expect(style.paints).toEqual([
      { type: 'SOLID', color: { r: 0, g: 1, b: 0 }, opacity: 1, visible: true },
    ]);
    expect(result).toEqual({ ok: true, styleId: 'S:0', name: 'new' });
  });

  it('throws when style is missing or not a paint style', async () => {
    await expect(
      createUpdatePaintStyleHandler(fakeFigma(null))({ styleId: 'S:9' }),
    ).rejects.toThrow(/not found/);
    await expect(
      createUpdatePaintStyleHandler(fakeFigma({ id: 'S:0', type: 'TEXT' }))({ styleId: 'S:0' }),
    ).rejects.toThrow(/not found/);
    await expect(createUpdatePaintStyleHandler(fakeFigma(null))({})).rejects.toThrow(/styleId/);
  });

  // Re-syncing a style from code is the common case, and it is where a binding gets clobbered:
  // paints replace wholesale, so the binding has to be re-sent — and then actually applied.
  it('re-applies a binding sent with the new paints', async () => {
    const style = { id: 'S:0', type: 'PAINT', name: 'n', paints: [] as unknown, description: '' };
    await createUpdatePaintStyleHandler(
      fakeFigma(style, { 'V:1': { id: 'V:1', name: 'token', resolvedType: 'COLOR' } }),
    )({
      styleId: 'S:0',
      paints: [
        {
          type: 'SOLID',
          visible: true,
          opacity: 1,
          color: { r: 0, g: 1, b: 0 },
          boundVariables: { color: 'V:1' },
        },
      ],
    });
    expect(style.paints).toEqual([
      expect.objectContaining({ boundVariables: { color: { type: 'VARIABLE_ALIAS', id: 'V:1' } } }),
    ]);
  });

  it('leaves the style untouched when a bound variable cannot be resolved', async () => {
    const style = { id: 'S:0', type: 'PAINT', name: 'n', paints: 'UNTOUCHED', description: '' };
    await expect(
      createUpdatePaintStyleHandler(fakeFigma(style))({
        styleId: 'S:0',
        paints: [
          {
            type: 'SOLID',
            visible: true,
            opacity: 1,
            color: { r: 0, g: 1, b: 0 },
            boundVariables: { color: 'V:gone' },
          },
        ],
      }),
    ).rejects.toThrow('update_paint_style: variable V:gone not found');
    expect(style.paints).toBe('UNTOUCHED');
  });

  // Measured on main: the style was renamed before the missing variable failed the call.
  it('leaves every field alone when a bound variable cannot be resolved', async () => {
    const style = { id: 'S:0', type: 'PAINT', name: 'n', paints: 'UNTOUCHED', description: 'd' };
    await expect(
      createUpdatePaintStyleHandler(fakeFigma(style))({
        styleId: 'S:0',
        name: 'renamed',
        description: 'changed',
        paints: [
          { type: 'SOLID', color: { r: 0, g: 1, b: 0 }, boundVariables: { color: 'V:gone' } },
        ],
      }),
    ).rejects.toThrow('update_paint_style: variable V:gone not found');
    expect(style).toEqual({
      id: 'S:0',
      type: 'PAINT',
      name: 'n',
      paints: 'UNTOUCHED',
      description: 'd',
    });
  });

  it('puts back what it wrote when Figma refuses a later write', async () => {
    const style: Record<string, unknown> = {
      id: 'S:0',
      type: 'PAINT',
      name: 'n',
      description: 'd',
    };
    let paints: unknown = ['old'];
    Object.defineProperty(style, 'paints', {
      enumerable: true,
      get: () => paints,
      set: (value: unknown) => {
        if (Array.isArray(value) && value.length === 0) throw new Error('in set_paints: refused');
        paints = value;
      },
    });
    await expect(
      createUpdatePaintStyleHandler(fakeFigma(style))({
        styleId: 'S:0',
        name: 'renamed',
        paints: [],
      }),
    ).rejects.toThrow(/^in set_paints: refused$/);
    expect([style.name, style.description, paints]).toEqual(['n', 'd', ['old']]);
  });

  it('says so when it cannot put the style back', async () => {
    let names = 0;
    const style: Record<string, unknown> = { id: 'S:0', type: 'PAINT', description: 'd' };
    let name = 'n';
    Object.defineProperty(style, 'name', {
      enumerable: true,
      get: () => name,
      set: (value: string) => {
        names += 1;
        if (names > 1) throw new Error('in set_name: refused');
        name = value;
      },
    });
    Object.defineProperty(style, 'paints', {
      enumerable: true,
      get: () => ['old'],
      set: () => {
        throw new Error('in set_paints: refused');
      },
    });
    await expect(
      createUpdatePaintStyleHandler(fakeFigma(style))({
        styleId: 'S:0',
        name: 'renamed',
        paints: [],
      }),
    ).rejects.toThrow(
      'in set_paints: refused — and the style could not be put back: in set_name: refused',
    );
  });

  // Dev Mode refuses the first write, so there is nothing to put back and Figma's words stand.
  it("passes the editor's refusal of the first write through untouched", async () => {
    const style: Record<string, unknown> = {
      id: 'S:0',
      type: 'PAINT',
      paints: [],
      description: 'd',
    };
    Object.defineProperty(style, 'name', {
      enumerable: true,
      get: () => 'n',
      set: () => {
        throw new Error('in set_name: Can\'t set "name" in read-only mode');
      },
    });
    await expect(
      createUpdatePaintStyleHandler(fakeFigma(style))({
        styleId: 'S:0',
        name: 'x',
        description: 'y',
      }),
    ).rejects.toThrow(/^in set_name: Can't set "name" in read-only mode$/);
    expect(style.description).toBe('d');
  });

  // Resolved before the first write, not merely rolled back after it: a write followed by a restore
  // still costs the user an empty Cmd+Z step (measured), and Dev Mode lets a description through.
  it('writes nothing at all when a bound variable cannot be resolved', async () => {
    const writes: string[] = [];
    const style = new Proxy(
      { id: 'S:0', type: 'PAINT', name: 'n', paints: [] as unknown, description: 'd' },
      {
        set: (target, key, value) => {
          writes.push(String(key));
          return Reflect.set(target, key, value);
        },
      },
    );
    await expect(
      createUpdatePaintStyleHandler(fakeFigma(style))({
        styleId: 'S:0',
        name: 'renamed',
        description: 'changed',
        paints: [
          { type: 'SOLID', color: { r: 0, g: 1, b: 0 }, boundVariables: { color: 'V:gone' } },
        ],
      }),
    ).rejects.toThrow('variable V:gone not found');
    expect(writes).toEqual([]);
  });

  it('names what it could not put back when the restore lands short', async () => {
    const style: Record<string, unknown> = { id: 'S:0', type: 'PAINT', description: 'd' };
    let name = 'n';
    Object.defineProperty(style, 'name', {
      enumerable: true,
      get: () => name,
      // Takes the first write and silently ignores the restore.
      set: (value: string) => {
        if (name === 'n') name = value;
      },
    });
    Object.defineProperty(style, 'paints', {
      enumerable: true,
      get: () => ['old'],
      set: () => {
        throw new Error('in set_paints: refused');
      },
    });
    await expect(
      createUpdatePaintStyleHandler(fakeFigma(style))({
        styleId: 'S:0',
        name: 'renamed',
        paints: [],
      }),
    ).rejects.toThrow(
      'in set_paints: refused — and the style could not be put back exactly: name still differs',
    );
  });

  it('sets, replaces and clears the documentation link', async () => {
    const style: Record<string, unknown> = {
      id: 'S:0',
      type: 'PAINT',
      name: 'n',
      paints: [],
      description: '',
      documentationLinks: [],
    };
    await createUpdatePaintStyleHandler(fakeFigma(style))({
      styleId: 'S:0',
      documentationLinks: [{ uri: 'https://a.com' }],
    });
    expect(style.documentationLinks).toEqual([{ uri: 'https://a.com' }]);
    await createUpdatePaintStyleHandler(fakeFigma(style))({
      styleId: 'S:0',
      documentationLinks: [],
    });
    expect(style.documentationLinks).toEqual([]);
  });

  it('leaves the style as it was when Figma refuses the link', async () => {
    const style: Record<string, unknown> = {
      id: 'S:0',
      type: 'PAINT',
      name: 'n',
      paints: ['old'],
      description: 'd',
    };
    Object.defineProperty(style, 'documentationLinks', {
      get: () => [],
      set: () => {
        throw new Error('in set_documentationLinks: Documentation link must be a URL');
      },
    });
    await expect(
      createUpdatePaintStyleHandler(fakeFigma(style))({
        styleId: 'S:0',
        name: 'renamed',
        description: 'x',
        documentationLinks: [{ uri: 'www.a.com' }],
      }),
    ).rejects.toThrow('Documentation link must be a URL');
    expect([style.name, style.description]).toEqual(['n', 'd']);
  });

  it('puts the link back when a later write is refused', async () => {
    const style: Record<string, unknown> = {
      id: 'S:0',
      type: 'PAINT',
      name: 'n',
      description: 'd',
      documentationLinks: [{ uri: 'https://old.com' }],
    };
    Object.defineProperty(style, 'paints', {
      enumerable: true,
      get: () => [],
      set: () => {
        throw new Error('in set_paints: refused');
      },
    });
    await expect(
      createUpdatePaintStyleHandler(fakeFigma(style))({
        styleId: 'S:0',
        documentationLinks: [{ uri: 'https://new.com' }],
        paints: [],
      }),
    ).rejects.toThrow(/^in set_paints: refused$/);
    expect(style.documentationLinks).toEqual([{ uri: 'https://old.com' }]);
  });

  it('says in adjusted when the link was stored differently from what was sent', async () => {
    const style: Record<string, unknown> = { id: 'S:0', type: 'PAINT', name: 'n' };
    normalizingLinks(style);
    const result = await createUpdatePaintStyleHandler(fakeFigma(style))({
      styleId: 'S:0',
      documentationLinks: [{ uri: 'HTTPS://A.COM' }],
    });
    expect(result).toEqual({
      ok: true,
      styleId: 'S:0',
      name: 'n',
      adjusted: 'documentationLinks were stored as ["https://a.com"]',
    });
  });
});
