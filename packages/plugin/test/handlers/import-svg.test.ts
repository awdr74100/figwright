import type { CreateResult } from '@figwright/shared';
import { describe, expect, it, vi } from 'vitest';

import { createImportSvgHandler } from '../../src/handlers/import-svg.js';

interface FakeFrame {
  id: string;
  name: string;
  type: string;
  width: number;
  height: number;
  x: number;
  y: number;
  resize: (w: number, h: number) => void;
}

const makeFigma = (): {
  figma: typeof figma;
  frame: FakeFrame;
  page: { appendChild: ReturnType<typeof vi.fn> };
  createNodeFromSvg: ReturnType<typeof vi.fn>;
} => {
  const frame: FakeFrame = {
    id: 'F:1',
    name: 'svg',
    type: 'FRAME',
    width: 24,
    height: 24,
    x: 0,
    y: 0,
    resize(w, h) {
      this.width = w;
      this.height = h;
    },
  };
  const page = { appendChild: vi.fn<(n: unknown) => void>() };
  const createNodeFromSvg = vi.fn<(svg: string) => FakeFrame>(() => frame);
  const figmaCtx = {
    createNodeFromSvg,
    currentPage: page,
  } as unknown as typeof figma;
  return { figma: figmaCtx, frame, page, createNodeFromSvg };
};

const SVG = '<svg viewBox="0 0 24 24"><path d="M4 4h16v16H4z"/></svg>';

describe('import_svg handler', () => {
  it('creates vector nodes from the markup and places them at intrinsic size', async () => {
    const { figma: f, frame, page, createNodeFromSvg } = makeFigma();
    const result = (await createImportSvgHandler(f)({ svg: SVG, name: 'Logo' })) as CreateResult;

    expect(createNodeFromSvg).toHaveBeenCalledWith(SVG);
    expect(frame.width).toBe(24); // unchanged — no override
    expect(page.appendChild).toHaveBeenCalledWith(frame);
    expect(result).toEqual({ ok: true, nodeId: 'F:1', name: 'Logo', type: 'FRAME' });
  });

  it('honors width/height overrides and position', async () => {
    const { figma: f, frame } = makeFigma();
    await createImportSvgHandler(f)({ svg: SVG, width: 48, height: 48, x: 10, y: 20 });
    expect(frame.width).toBe(48);
    expect(frame.height).toBe(48);
    expect(frame.x).toBe(10);
    expect(frame.y).toBe(20);
  });

  it('throws on empty or non-string svg', async () => {
    const { figma: f } = makeFigma();
    await expect(createImportSvgHandler(f)({ svg: '   ' })).rejects.toThrow(/non-empty SVG/);
    await expect(createImportSvgHandler(f)({ name: 'x' })).rejects.toThrow(/non-empty SVG/);
  });

  // An SVG's colours are CSS colours (sRGB), but createNodeFromSvg keeps their channels: in a
  // Display P3 file they would paint more saturated than the markup. Measured live.
  describe('in a Display P3 document', () => {
    const imported = () => {
      const path = {
        fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 0.8, g: 0.4, b: 0.2 } }],
        strokes: [
          {
            type: 'GRADIENT_LINEAR',
            gradientStops: [{ position: 0, color: { r: 1, g: 0, b: 0, a: 0.5 } }],
            gradientTransform: [
              [1, 0, 0],
              [0, 1, 0],
            ],
          },
        ],
        effects: [
          { type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 1, a: 0.25 }, offset: { x: 0, y: 1 } },
          { type: 'LAYER_BLUR', radius: 2 },
        ],
      };
      const text = { fills: Symbol('mixed'), strokes: [], effects: [] };
      const frame = {
        id: 'F:1',
        name: 'svg',
        type: 'FRAME',
        width: 24,
        height: 24,
        x: 0,
        y: 0,
        resize: () => undefined,
        fills: [] as unknown[],
        strokes: [] as unknown[],
        effects: [] as unknown[],
        findAll: () => [path, text],
      };
      return { frame, path, text };
    };
    const figmaWith = (profile: string, frame: object, util: unknown) =>
      ({
        root: { documentColorProfile: profile },
        createNodeFromSvg: () => frame,
        currentPage: { appendChild: () => undefined },
        util,
      }) as unknown as typeof figma;
    const halve = {
      rgb: (c: { space: string; r: number; g: number; b: number }) => {
        expect(c.space).toBe('SRGB');
        return { r: c.r / 2, g: c.g / 2, b: c.b / 2 };
      },
    };

    it('converts every imported fill, stroke stop and shadow colour from sRGB', async () => {
      const { frame, path, text } = imported();
      const textFills = text.fills;
      await createImportSvgHandler(figmaWith('DISPLAY_P3', frame, halve))({ svg: SVG });
      expect(path.fills[0]?.color).toEqual({ r: 0.4, g: 0.2, b: 0.1 });
      expect(path.strokes[0]?.gradientStops[0]?.color).toEqual({ r: 0.5, g: 0, b: 0, a: 0.5 });
      expect(path.effects[0]).toMatchObject({ color: { r: 0, g: 0, b: 0.5, a: 0.25 } });
      expect(path.effects[1]).toEqual({ type: 'LAYER_BLUR', radius: 2 });
      expect(text.fills).toBe(textFills);
    });

    it('leaves an sRGB document exactly as createNodeFromSvg made it', async () => {
      const { frame, path } = imported();
      const before = structuredClone(path);
      const untouchable = new Proxy(
        {},
        {
          get: () => {
            throw new Error('util must not be read in an sRGB document');
          },
        },
      );
      await createImportSvgHandler(figmaWith('SRGB', frame, untouchable))({ svg: SVG });
      expect(path).toEqual(before);
    });
  });
});
