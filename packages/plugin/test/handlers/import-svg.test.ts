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
});
