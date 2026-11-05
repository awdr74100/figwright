import type { CreateResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { applyCreateSize, readCreateSize } from './create-size.js';
import { applyInitialProps } from './initial-props.js';
import { placeNode } from './place.js';

export const createCreateFrameHandler =
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

    const size = readCreateSize(p, 'create_frame');

    const frame = figmaCtx.createFrame();
    if (typeof p.name === 'string') frame.name = p.name;
    applyCreateSize(frame, size, (w, h) => frame.resize(w, h));
    if (typeof p.x === 'number') frame.x = p.x;
    if (typeof p.y === 'number') frame.y = p.y;

    await placeNode(figmaCtx, frame, p.parentId, 'create_frame');
    // Turning auto layout on makes Figma hug the primary axis, which would silently discard a
    // width / height passed in this same call. A side passed therefore means FIXED on its axis
    // unless the caller sized that axis otherwise; a side left out is Figma's to size.
    const props = { ...(params as Record<string, unknown>) };
    if (props.autoLayout !== undefined) {
      if (size.width !== undefined) props.layoutSizingHorizontal ??= 'FIXED';
      if (size.height !== undefined) props.layoutSizingVertical ??= 'FIXED';
    }
    await applyInitialProps(figmaCtx, frame, props, 'create_frame');

    const result: CreateResult = { ok: true, nodeId: frame.id, name: frame.name, type: frame.type };
    return result;
  };
