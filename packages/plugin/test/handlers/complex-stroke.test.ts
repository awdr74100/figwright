import { describe, expect, it, vi } from 'vitest';

import { createSetComplexStrokeHandler } from '../../src/handlers/complex-stroke.js';

const setup = (over: Record<string, unknown> = {}) => {
  const log: string[] = [];
  const node: Record<string, unknown> = {
    id: '1:1',
    type: 'VECTOR',
    strokes: [{ type: 'SOLID', visible: true, color: { r: 0, g: 0, b: 0 } }],
    ...over,
  };
  let complex: unknown = { type: 'BASIC' };
  let widths: unknown = { widthProfile: 'UNIFORM', variableWidthPoints: [] };
  Object.defineProperty(node, 'complexStrokeProperties', {
    get: () => complex,
    set: v => {
      log.push('complex');
      complex = v;
    },
    enumerable: true,
  });
  Object.defineProperty(node, 'variableWidthStrokeProperties', {
    get: () => widths,
    set: v => {
      log.push('widths');
      if (over.branches === true) {
        throw new Error(
          'in set_variableWidthStrokeProperties: Cannot set it on complex vector nodes',
        );
      }
      widths = v;
    },
    enumerable: true,
  });
  const loadBrushesAsync = vi.fn<(kind: string) => Promise<void>>(async (kind: string) => {
    log.push(`load:${kind}`);
  });
  const ctx = {
    getNodeByIdAsync: async () => node,
    loadBrushesAsync,
  } as unknown as typeof figma;
  return { ctx, node, log, loadBrushesAsync, complex: () => complex, widths: () => widths };
};

const run = (ctx: typeof figma, params: Record<string, unknown>) =>
  createSetComplexStrokeHandler(ctx)({ nodeId: '1:1', ...params });

describe('set_complex_stroke handler', () => {
  it('loads the brush kind, then writes the width profile before the brush', async () => {
    const t = setup();
    await run(t.ctx, {
      complexStrokeProperties: { type: 'BRUSH', brushType: 'SCATTER', brushName: 'OI', gap: 2 },
      variableWidthStrokeProperties: {
        widthProfile: 'TAPER',
        variableWidthPoints: [{ position: 0, width: 1 }],
      },
    });
    expect(t.log).toEqual(['load:SCATTER', 'widths', 'complex']);
    expect(t.complex()).toEqual({ type: 'BRUSH', brushType: 'SCATTER', brushName: 'OI', gap: 2 });
    // A preset's points are its own: the ones read back with it are not written.
    expect(t.widths()).toEqual({ widthProfile: 'TAPER' });
  });

  it('writes a CUSTOM profile with its points, and needs them', async () => {
    const t = setup();
    const points = [
      { position: 0, width: 0.2 },
      { position: 1, width: 1 },
    ];
    await run(t.ctx, {
      variableWidthStrokeProperties: { widthProfile: 'CUSTOM', variableWidthPoints: points },
    });
    expect(t.widths()).toEqual({ widthProfile: 'CUSTOM', variableWidthPoints: points });
    await expect(
      run(t.ctx, { variableWidthStrokeProperties: { widthProfile: 'CUSTOM' } }),
    ).rejects.toThrow('needs variableWidthPoints');
  });

  it.each([
    [
      { type: 'BRUSH', brushType: 'STRETCH', brushName: 'NOIR', gap: 2 },
      'gap does not apply to a STRETCH stroke (it takes direction)',
    ],
    [
      { type: 'BRUSH', brushType: 'SCATTER', brushName: 'NOIR' },
      'a SCATTER brush needs a brushName from',
    ],
    [
      { type: 'BRUSH', brushType: 'STRETCH', brushName: 'CUSTOM' },
      'cannot be set through the plugin API',
    ],
    [
      { type: 'DYNAMIC', frequency: 3, direction: 'FORWARD' },
      'direction does not apply to a DYNAMIC stroke',
    ],
    [{ type: 'BASIC', wiggle: 1 }, 'wiggle does not apply to a BASIC stroke'],
    [{ type: 'BRUSH' }, 'needs type BASIC, DYNAMIC, or BRUSH with brushType'],
  ])('refuses %j before writing anything', async (complexStrokeProperties, message) => {
    const t = setup();
    await expect(run(t.ctx, { complexStrokeProperties })).rejects.toThrow(message);
    expect(t.log).toEqual([]);
  });

  it('refuses a node with no visible stroke for the brush to shape', async () => {
    for (const strokes of [[], [{ type: 'SOLID', visible: false, color: { r: 0, g: 0, b: 0 } }]]) {
      const t = setup({ strokes });
      await expect(run(t.ctx, { complexStrokeProperties: { type: 'DYNAMIC' } })).rejects.toThrow(
        'has no visible stroke',
      );
      expect(t.log).toEqual([]);
    }
  });

  it('says why a branching vector refuses a width profile, with the brush left unwritten', async () => {
    const t = setup({ branches: true });
    await expect(
      run(t.ctx, {
        complexStrokeProperties: { type: 'DYNAMIC', frequency: 3 },
        variableWidthStrokeProperties: { widthProfile: 'EYE' },
      }),
    ).rejects.toThrow('a vector that branches, which cannot take a width profile');
    expect(t.complex()).toEqual({ type: 'BASIC' });
  });

  it('needs at least one of the two', async () => {
    const t = setup();
    await expect(run(t.ctx, {})).rejects.toThrow('give complexStrokeProperties');
  });
});
