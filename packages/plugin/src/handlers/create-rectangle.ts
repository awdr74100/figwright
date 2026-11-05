import type { CreateResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { applyCreateSize, readCreateSize } from './create-size.js';
import { applyInitialProps } from './initial-props.js';
import { placeNode } from './place.js';

export const createCreateRectangleHandler =
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

    const size = readCreateSize(p, 'create_rectangle');

    const rect = figmaCtx.createRectangle();
    if (typeof p.name === 'string') rect.name = p.name;
    applyCreateSize(rect, size, (w, h) => rect.resize(w, h));
    if (typeof p.x === 'number') rect.x = p.x;
    if (typeof p.y === 'number') rect.y = p.y;

    await placeNode(figmaCtx, rect, p.parentId, 'create_rectangle');
    await applyInitialProps(figmaCtx, rect, params as Record<string, unknown>, 'create_rectangle');

    const result: CreateResult = { ok: true, nodeId: rect.id, name: rect.name, type: rect.type };
    return result;
  };
