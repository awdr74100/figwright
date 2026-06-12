import type { GetViewportResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

export const createGetViewportHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async () => {
    const { center, zoom, bounds } = figmaCtx.viewport;
    const result: GetViewportResult = {
      center: { x: center.x, y: center.y },
      zoom,
      bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
    };
    return result;
  };
