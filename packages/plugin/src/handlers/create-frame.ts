import type { CreateResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
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

    const frame = figmaCtx.createFrame();
    if (typeof p.name === 'string') frame.name = p.name;
    const sized = typeof p.width === 'number' && typeof p.height === 'number';
    if (sized) frame.resize(p.width as number, p.height as number);
    if (typeof p.x === 'number') frame.x = p.x;
    if (typeof p.y === 'number') frame.y = p.y;

    await placeNode(figmaCtx, frame, p.parentId, 'create_frame');
    // Turning auto layout on makes Figma hug the primary axis, which would silently discard a
    // width / height passed in this same call. An explicit size therefore means FIXED on any axis
    // the caller did not size otherwise.
    const props = { ...(params as Record<string, unknown>) };
    if (sized && props.autoLayout !== undefined) {
      props.layoutSizingHorizontal ??= 'FIXED';
      props.layoutSizingVertical ??= 'FIXED';
    }
    await applyInitialProps(figmaCtx, frame, props, 'create_frame');

    const result: CreateResult = { ok: true, nodeId: frame.id, name: frame.name, type: frame.type };
    return result;
  };
