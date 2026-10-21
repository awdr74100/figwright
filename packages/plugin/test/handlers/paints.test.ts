import { describe, expect, it, vi } from 'vitest';

import { writePaints } from '../../src/handlers/paints.js';

describe('writePaints', () => {
  const pattern = { type: 'PATTERN', sourceNodeId: '1:1' } as unknown as Paint;
  const solid = { type: 'SOLID', color: { r: 1, g: 0, b: 0 } } as SolidPaint;

  it('keeps the synchronous setter for every paint list without a pattern', async () => {
    const setFillsAsync = vi.fn<(paints: unknown) => Promise<void>>();
    const node = { fills: [], setFillsAsync } as unknown as BaseNode & { fills: Paint[] };
    await writePaints(node, 'fills', [solid]);
    expect(node.fills).toEqual([solid]);
    expect(setFillsAsync).not.toHaveBeenCalled();
  });

  it('routes a list holding a pattern through the async setter, the only one that takes it', async () => {
    const setFillsAsync = vi.fn<(paints: unknown) => Promise<void>>();
    const setStrokesAsync = vi.fn<(paints: unknown) => Promise<void>>();
    const node = { setFillsAsync, setStrokesAsync } as unknown as BaseNode;
    await writePaints(node, 'fills', [solid, pattern]);
    await writePaints(node, 'strokes', [pattern]);
    expect(setFillsAsync).toHaveBeenCalledWith([solid, pattern]);
    expect(setStrokesAsync).toHaveBeenCalledWith([pattern]);
  });
});
