import type { CreateTextResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { applyInitialProps } from './initial-props.js';
import { placeNode } from './place.js';
import { checkTextBox } from './set-text-properties.js';

/**
 * Refuse a width / height that this call's textAutoResize, or a HUG or FILL on the same axis, would
 * undo — the size is written before the sizing and the mode, so either would silently win. Checked
 * before the node exists, so a refused call leaves nothing behind — not even a create-then-remove
 * in the file's undo history.
 */
const checkBox = (p: Record<string, unknown>): void => {
  checkTextBox(p, 'create_text');
  for (const [side, axis] of [
    ['width', 'layoutSizingHorizontal'],
    ['height', 'layoutSizingVertical'],
  ] as const) {
    const sizing = p[axis];
    if (p[side] !== undefined && (sizing === 'HUG' || sizing === 'FILL')) {
      throw new TypeError(
        `create_text: ${side} conflicts with ${axis} ${sizing}, which sizes it instead — drop ` +
          'one, or pass FIXED',
      );
    }
  }
};

export const createCreateTextHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as {
      parentId?: unknown;
      characters?: unknown;
      x?: unknown;
      y?: unknown;
    };
    if (typeof p.characters !== 'string') {
      throw new TypeError('create_text: characters must be a string');
    }
    checkBox(p as Record<string, unknown>);

    const text = figmaCtx.createText();
    await figmaCtx.loadFontAsync(text.fontName as FontName); // default font must be loaded first
    text.characters = p.characters;
    if (typeof p.x === 'number') text.x = p.x;
    if (typeof p.y === 'number') text.y = p.y;

    await placeNode(figmaCtx, text, p.parentId, 'create_text');
    // Typography (fontSize included), box size, fill and sizing go through the set_* handlers once
    // placed.
    const adjusted = await applyInitialProps(
      figmaCtx,
      text,
      params as Record<string, unknown>,
      'create_text',
    );

    const result: CreateTextResult = {
      ok: true,
      nodeId: text.id,
      name: text.name,
      type: text.type,
      width: text.width,
      height: text.height,
      ...(adjusted !== undefined && { adjusted }),
    };
    return result;
  };
