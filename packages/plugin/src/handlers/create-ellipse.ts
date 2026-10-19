import type { CreateResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { applyInitialProps } from './initial-props.js';
import { placeNode } from './place.js';

export const createCreateEllipseHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as {
      parentId?: unknown;
      name?: unknown;
      x?: unknown;
      y?: unknown;
      width?: unknown;
      height?: unknown;
    };

    const ellipse = figmaCtx.createEllipse();
    if (typeof p.name === 'string') ellipse.name = p.name;
    if (typeof p.width === 'number' && typeof p.height === 'number') {
      ellipse.resize(p.width, p.height);
    }
    if (typeof p.x === 'number') ellipse.x = p.x;
    if (typeof p.y === 'number') ellipse.y = p.y;

    await placeNode(figmaCtx, ellipse, p.parentId, 'create_ellipse');
    await applyInitialProps(figmaCtx, ellipse, params as Record<string, unknown>, 'create_ellipse');

    const result: CreateResult = {
      ok: true,
      nodeId: ellipse.id,
      name: ellipse.name,
      type: ellipse.type,
    };
    return result;
  };
