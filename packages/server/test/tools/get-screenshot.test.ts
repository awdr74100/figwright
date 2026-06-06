import type { GetScreenshotResult } from '@figma-mcp-relay/shared';
import { describe, expect, it } from 'vitest';

import { screenshotContent } from '../../src/tools/get-screenshot.js';

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
});
