import { describe, expect, it } from 'vitest';

import { createGridStyleTool } from '../../src/tools/create-grid-style.js';
import { gridItemSchema } from '../../src/tools/grid-schema.js';
import { setLayoutGridsTool } from '../../src/tools/set-layout-grids.js';

// A grid colour Figma would refuse — no alpha, a channel outside 0–1 — must reach the plugin, which
// leaves that colour out and reports it, instead of the server refusing every grid in the call.
// Before colours were read, a colour sent here was ignored and the call succeeded; it still does.

const grid = (color: unknown) => ({ pattern: 'GRID', visible: true, sectionSize: 8, color });

describe('layout grid colour on write inputs', () => {
  it('passes a colour Figma would refuse through to the plugin', () => {
    for (const color of [
      { r: 0, g: 0, b: 1 },
      { r: 255, g: 0, b: 0, a: 0.1 },
      { r: -1, g: 2, b: 0, a: 3 },
    ]) {
      expect(gridItemSchema.parse(grid(color)).color).toEqual(color);
      expect(
        setLayoutGridsTool.inputSchema.safeParse({ nodeId: '1:1', grids: [grid(color)] }).success,
      ).toBe(true);
      expect(
        createGridStyleTool.inputSchema.safeParse({ name: 'x', grids: [grid(color)] }).success,
      ).toBe(true);
    }
  });

  it('keeps a colour that names its space, and refuses one that is not a colour at all', () => {
    expect(gridItemSchema.parse(grid({ r: 0, g: 0, b: 1, a: 0.2, space: 'SRGB' })).color).toEqual({
      r: 0,
      g: 0,
      b: 1,
      a: 0.2,
      space: 'SRGB',
    });
    expect(gridItemSchema.safeParse(grid('red')).success).toBe(false);
    expect(gridItemSchema.safeParse(grid({ r: 0, g: 0, b: 1, a: 1, space: 'CMYK' })).success).toBe(
      false,
    );
  });

  it('parses a grid without a colour exactly as before', () => {
    expect(gridItemSchema.parse({ pattern: 'GRID', visible: true, sectionSize: 8 })).toEqual({
      pattern: 'GRID',
      visible: true,
      sectionSize: 8,
    });
  });
});
