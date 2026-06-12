import type { GetViewportResult } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import { createGetViewportHandler } from '../../src/handlers/get-viewport.js';

describe('get_viewport handler', () => {
  it('returns center / zoom / bounds from figma.viewport', async () => {
    const figmaCtx = {
      viewport: {
        center: { x: 100, y: 200 },
        zoom: 0.5,
        bounds: { x: -10, y: -20, width: 800, height: 600 },
      },
    } as unknown as typeof figma;
    const result = (await createGetViewportHandler(figmaCtx)(undefined)) as GetViewportResult;
    expect(result).toEqual({
      center: { x: 100, y: 200 },
      zoom: 0.5,
      bounds: { x: -10, y: -20, width: 800, height: 600 },
    });
  });
});
