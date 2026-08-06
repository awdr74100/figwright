import type { GetScreenshotResult } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import { INLINE_IMAGE_BUDGET_BYTES, screenshotContent } from '../../src/tools/get-screenshot.js';

describe('screenshotContent', () => {
  it('emits a label + image block for raster formats with the right mime type', () => {
    const result: GetScreenshotResult = {
      images: [
        { nodeId: '1:1', format: 'PNG', base64: 'AAAA' },
        { nodeId: '1:2', format: 'JPG', base64: 'BBBB' },
      ],
    };
    expect(screenshotContent(result)).toEqual([
      { type: 'text', text: '1:1 (PNG)' },
      { type: 'image', data: 'AAAA', mimeType: 'image/png' },
      { type: 'text', text: '1:2 (JPG)' },
      { type: 'image', data: 'BBBB', mimeType: 'image/jpeg' },
    ]);
  });

  it('labels a raster with its exported size + scale when the plugin reports them', () => {
    const result: GetScreenshotResult = {
      images: [
        { nodeId: '1:1', format: 'PNG', base64: 'AAAA', width: 1536, height: 1000, scale: 0.5 },
        {
          nodeId: '1:2',
          format: 'PNG',
          base64: 'BBBB',
          width: 96,
          height: 96,
          scale: 4,
          recovered: true,
        },
      ],
    };
    const blocks = screenshotContent(result);
    expect(blocks[0]).toEqual({ type: 'text', text: '1:1 (PNG 1536×1000px @0.5x)' });
    expect(blocks[2]).toEqual({
      type: 'text',
      text: '1:2 (PNG 96×96px @4x) — ↺ recovered (clipped/off-canvas; rendered at intrinsic bounds)',
    });
  });

  it('returns SVG markup as readable text rather than an image block', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"/>';
    const result: GetScreenshotResult = {
      images: [{ nodeId: '1:3', format: 'SVG', base64: Buffer.from(svg).toString('base64') }],
    };
    const blocks = screenshotContent(result);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({ type: 'text', text: `1:3 (SVG):\n${svg}` });
  });

  it('notes missing / non-exportable nodes as text', () => {
    const result: GetScreenshotResult = {
      images: [{ nodeId: '9:9', format: 'PNG', base64: null }],
    };
    expect(screenshotContent(result)).toEqual([{ type: 'text', text: '9:9: not exportable' }]);
  });

  it('falls back to a note when there are no images', () => {
    expect(screenshotContent({ images: [] })).toEqual([
      { type: 'text', text: 'No nodes exported.' },
    ]);
  });

  describe('batch size budget', () => {
    /** A raster whose base64 payload is `kb` kilobytes. */
    const raster = (n: number, kb: number): GetScreenshotResult['images'][number] => ({
      nodeId: `1:${n}`,
      format: 'PNG',
      base64: 'A'.repeat(kb * 1024),
      width: 100,
      height: 200,
      scale: 1,
    });
    const imagesIn = (blocks: ReturnType<typeof screenshotContent>): string[] =>
      blocks.flatMap(b => (b.type === 'image' ? [b.data] : []));
    const noteIn = (blocks: ReturnType<typeof screenshotContent>): string =>
      blocks.findLast(b => b.type === 'text')?.text ?? '';

    it('inlines every export when the batch fits, with no note', () => {
      const blocks = screenshotContent({ images: [raster(1, 1), raster(2, 1)] });
      expect(imagesIn(blocks)).toHaveLength(2);
      expect(noteIn(blocks)).not.toContain('not inlined');
    });

    it('stops inlining at the budget but still labels every node', () => {
      // 10 KB each against a budget that fits two payloads.
      const blocks = screenshotContent(
        { images: [raster(1, 10), raster(2, 10), raster(3, 10)] },
        25 * 1024,
      );
      expect(imagesIn(blocks)).toHaveLength(2);
      // Every requested node is still named — that is what lets the model re-request the rest.
      for (const id of ['1:1', '1:2', '1:3']) {
        expect(blocks.some(b => b.type === 'text' && b.text.startsWith(`${id} (PNG`))).toBe(true);
      }
      // The deferred one says so on its own label, not only in the note.
      expect(
        blocks.some(
          b => b.type === 'text' && b.text.includes('1:3') && b.text.includes('not inlined'),
        ),
      ).toBe(true);
    });

    it('names the deferred ids and tells the model to split the call', () => {
      const blocks = screenshotContent({ images: [raster(1, 10), raster(2, 10)] }, 15 * 1024);
      const note = noteIn(blocks);
      expect(note).toContain('1 of 2');
      expect(note).toContain('1:2');
      expect(note).toContain('fewer ids per call');
      expect(note).not.toContain('smaller `scale`');
    });

    it('gives different advice when one export is oversized on its own', () => {
      // Splitting the call cannot help here, so telling the model to split would send it in a loop.
      const blocks = screenshotContent({ images: [raster(1, 100)] }, 10 * 1024);
      expect(imagesIn(blocks)).toHaveLength(0);
      const note = noteIn(blocks);
      expect(note).toContain('splitting the call will not help');
      expect(note).toContain('smaller `scale`');
      expect(note).toContain('save_screenshots');
      expect(note).not.toContain('fewer ids per call');
    });

    it('gives each cause its own remedy when a batch mixes both', () => {
      // One export oversized on its own plus one that merely ran out of room. Telling the model to
      // split the call would loop forever on the first; telling it to scale down is wrong for the
      // second. Both ids must appear against advice that actually works for them.
      const blocks = screenshotContent(
        { images: [raster(1, 8), raster(2, 30), raster(3, 15)] },
        20 * 1024,
      );
      const note = noteIn(blocks);
      expect(note).toContain('2 of 3');
      // 1:2 is oversized alone → scale/save advice, named against it.
      expect(note).toMatch(/1:2[^.]*exceeded the whole budget alone/);
      expect(note).toContain('smaller `scale`');
      // 1:3 merely did not fit → split advice, named against it.
      expect(note).toMatch(/Re-request 1:3/);
      expect(note).toContain('fewer ids per call');
    });

    it('never lets the inlined payload exceed the budget', () => {
      const blocks = screenshotContent(
        { images: [raster(1, 40), raster(2, 40), raster(3, 40)] },
        100 * 1024,
      );
      const inlined = blocks
        .filter(b => b.type === 'image')
        .reduce((n, b) => n + Buffer.byteLength(JSON.stringify(b), 'utf8'), 0);
      expect(inlined).toBeLessThanOrEqual(100 * 1024);
    });

    it('applies the budget to SVG markup too, which rides in its own text block', () => {
      const svg = `<svg>${'x'.repeat(20 * 1024)}</svg>`;
      const big = {
        nodeId: '2:1',
        format: 'SVG' as const,
        base64: Buffer.from(svg).toString('base64'),
      };
      const blocks = screenshotContent({ images: [big] }, 5 * 1024);
      expect(blocks.some(b => b.type === 'text' && b.text.includes('<svg>'))).toBe(false);
      expect(noteIn(blocks)).toContain('2:1');
    });

    it('does not spend budget on nodes that produced nothing', () => {
      const blocks = screenshotContent(
        { images: [{ nodeId: '9:9', format: 'PNG', base64: null }, raster(1, 10)] },
        15 * 1024,
      );
      // The unexportable node costs nothing, so the real export still fits.
      expect(imagesIn(blocks)).toHaveLength(1);
      expect(noteIn(blocks)).not.toContain('not inlined');
    });

    it('sets a default budget that fits the transport limit without wasting it', () => {
      // Under the 10 MB client read buffer, but close to it: a budget lower than it needs to be
      // would defer exports the transport could have carried, which is a regression, not a guard.
      expect(INLINE_IMAGE_BUDGET_BYTES).toBeLessThan(10 * 1024 * 1024);
      expect(INLINE_IMAGE_BUDGET_BYTES).toBeGreaterThan(9 * 1024 * 1024);
    });

    it('still inlines a single large export that the transport can carry', () => {
      // The regression guard for the common case: one node, one big image. Before any budget
      // existed this was delivered; anything under the transport limit must keep being delivered.
      const blocks = screenshotContent({ images: [raster(1, 9 * 1024)] });
      expect(imagesIn(blocks)).toHaveLength(1);
      expect(noteIn(blocks)).not.toContain('not inlined');
    });
  });
});
