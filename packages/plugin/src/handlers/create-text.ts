import type { CreateTextResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { applyInitialProps } from './initial-props.js';
import { placeNode } from './place.js';
import { checkMaxLines, checkTextBox, targetBox } from './set-text-properties.js';
import type { TextBox } from './text-box.js';

/** The box every new text node starts with: auto width, no ellipsis (read back from each create). */
const NEW_TEXT: TextBox = {
  autoResize: 'WIDTH_AND_HEIGHT',
  width: 0,
  height: 0,
  truncation: 'DISABLED',
  maxLines: null,
};

/**
 * Refuse a width / height that this call's textAutoResize, or a HUG or FILL on the same axis, would
 * undo — the box size is written with the typography and the sizing after it, so the sizing would
 * silently win — and a maxLines the box it lands on cannot hold. Checked before the node exists, so
 * a refused call leaves nothing behind — not even a create-then-remove in the file's undo history.
 */
const checkBox = (p: Record<string, unknown>): void => {
  const { width, height } = checkTextBox(p, 'create_text');
  const { box } = targetBox(NEW_TEXT, NEW_TEXT, p, width, height);
  // The sizing goes on after the typography, and a FIXED or FILL height fixes the box (measured),
  // which then shows no line count — so it counts as fixed here.
  const fixedHeight = p.layoutSizingVertical === 'FIXED' || p.layoutSizingVertical === 'FILL';
  checkMaxLines(fixedHeight ? { ...box, autoResize: 'NONE' } : box, p.maxLines, 'create_text');
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
    await applyInitialProps(figmaCtx, text, params as Record<string, unknown>, 'create_text');

    const result: CreateTextResult = {
      ok: true,
      nodeId: text.id,
      name: text.name,
      type: text.type,
      width: text.width,
      height: text.height,
    };
    return result;
  };
