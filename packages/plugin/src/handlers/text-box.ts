/**
 * A TEXT node's box: its size, auto-resize mode and line clamp, which Figma couples in ways the
 * typings never state. Each rule below was measured in a real file:
 *
 * - `resize()` fixes the box (textAutoResize NONE) only when the height changes. A resize that keeps
 *   the height leaves auto sizing on and re-wraps at the new width — auto width becoming auto
 *   height — and a resize to the size the box already has changes nothing at all.
 * - Writing textAutoResize to a value it does not already read turns the ellipsis off and clears
 *   maxLines; writing TRUNCATE (a fixed box with the ellipsis on) turns the ellipsis on.
 * - MaxLines reads back only on auto-sized text with textTruncation ENDING. On a fixed box it reads
 *   null whatever is written — except a free-standing box just fixed by a resize, which reads its
 *   old one until the next. Figma keeps some value out of sight and shows it again once layout
 *   sizing makes the box auto-sized, but which one it keeps varied between runs, so a fixed box is
 *   treated here as having none. Turning the ellipsis off clears maxLines; turning it on for
 *   auto-sized text that had none sets it to 1.
 * - Layout sizing moves the mode without touching the clamp: HUG makes auto size, FIXED or FILL
 *   height a fixed box.
 * - A vertically centred fixed box moved when switched to auto height.
 * - FigJam keeps a fixed text box at least as tall as its text: a resize below that lands on it (20,
 *   30 and 31 all came back 45 for a text needing 45; 100 stayed 100). The other rules here held
 *   there too.
 * - Inside an instance, `resize()` is ignored outright (the layer keeps its size, mode and sizing)
 *   and an x / y write throws — except in content Figma lets a plugin resize, such as a slot's. A
 *   mode or ellipsis write still lands there: NONE / TRUNCATE fixes auto-sized text at its size.
 *
 * Assigning the fields one by one therefore lands somewhere else depending on the order and on the
 * state the node starts in. {@link writeTextBox} is the one path to a box that respects them,
 * shared by set_text_properties and the batch restore.
 */

import { sameSize } from './size.js';

type AutoResize = TextNode['textAutoResize'];

/**
 * The box to reach. TRUNCATE is not a mode of its own here: it is how NONE reads back with the
 * ellipsis on, so it is expressed as `autoResize: 'NONE'` with `truncation: 'ENDING'`.
 */
export interface TextBox {
  autoResize: 'NONE' | 'HEIGHT' | 'WIDTH_AND_HEIGHT';
  /** Used by NONE and HEIGHT; WIDTH_AND_HEIGHT sizes itself. */
  width: number;
  /** Used by NONE only; HEIGHT and WIDTH_AND_HEIGHT size it to the text. */
  height: number;
  truncation: TextNode['textTruncation'];
  /** Only on an auto-sized box with truncation ENDING; null everywhere else. */
  maxLines: number | null;
}

export const isAutoSized = (mode: AutoResize): boolean =>
  mode === 'HEIGHT' || mode === 'WIDTH_AND_HEIGHT';

/** The box a TEXT node has now, in {@link TextBox} terms. */
export const readTextBox = (text: TextNode): TextBox => ({
  autoResize: isAutoSized(text.textAutoResize)
    ? (text.textAutoResize as 'HEIGHT' | 'WIDTH_AND_HEIGHT')
    : 'NONE',
  width: text.width,
  height: text.height,
  truncation: text.textTruncation,
  maxLines: text.maxLines,
});

/**
 * Whether {@link writeTextBox} has to resize the node to get from `from` to `to`: to fix a box at a
 * size it does not have, to re-fit a fixed box to its text, or to re-wrap auto-height text at a new
 * width. `measure` is a box first laid out in auto height to find the height it needs — which
 * auto-sized text kept at its width already has, so fixing it where it stands needs no resize: the
 * mode write alone does it, and lands inside an instance too (measured).
 */
export const boxNeedsResize = (from: TextBox, to: TextBox, measure: boolean): boolean => {
  if (to.autoResize === 'WIDTH_AND_HEIGHT') return false;
  if (to.autoResize === 'HEIGHT') return !sameSize(to.width, from.width);
  return (
    (from.autoResize === 'NONE' && measure) ||
    !sameSize(to.width, from.width) ||
    !sameSize(to.height, from.height)
  );
};

/**
 * Whether Figma applies `resize()` to this node at all — asked before anything is written, because
 * a box write that relies on a resize Figma then ignores lands half done (measured: a fixed label
 * inside an instance left in auto height). An ignored resize changes nothing (measured), so the
 * question is free when the answer is no; when it is yes the node is put back at its size, fixed.
 * Nudged both ways, so a min / max bound sitting on the current size cannot pass for "ignored".
 */
export const resizeTakes = (
  text: TextNode,
  resize: (width: number, height: number) => void,
): boolean => {
  const { width, height } = text;
  for (const step of [1, -1]) {
    const [w, h] = [width + step, height + step];
    if (w < 0.01 || h < 0.01) continue;
    resize(w, h);
    if (!sameSize(text.width, width) || !sameSize(text.height, height)) {
      resize(width, height);
      return true;
    }
  }
  return false;
};

/**
 * Fix the box at `width` × `height`. Only a change of height fixes an auto-sized box, so one
 * already at the height asked for — or re-wrapped to it by a width-only resize — is pushed off that
 * height and back. Both ways, so a min / max bound on one side cannot stop it; with the height
 * pinned both ways the mode is written directly, which clears the clamp — the caller writes the
 * ellipsis back.
 */
const fix = (
  text: TextNode,
  width: number,
  height: number,
  resize: (width: number, height: number) => void,
): void => {
  if (!sameSize(text.width, width) || !sameSize(text.height, height)) resize(width, height);
  for (const step of [1, -1]) {
    if (!isAutoSized(text.textAutoResize)) return;
    if (height + step < 0.01) continue;
    resize(width, height + step);
    resize(width, height);
  }
  if (isAutoSized(text.textAutoResize)) text.textAutoResize = 'NONE';
};

/** Placed by its auto-layout parent rather than by its own x / y. */
const inFlow = (node: SceneNode): boolean => {
  const layoutMode = (node.parent as { layoutMode?: unknown } | null)?.layoutMode;
  return (
    typeof layoutMode === 'string' &&
    layoutMode !== 'NONE' &&
    (node as { layoutPositioning?: string }).layoutPositioning !== 'ABSOLUTE'
  );
};

/**
 * Bring a TEXT node to `box`, writing only what differs: the size and mode first, since a mode
 * change clears the clamp, then the ellipsis, then maxLines — which a fixed box shows none of, so a
 * fixed box's leftover one is cleared by turning the ellipsis off and back on. The node ends where
 * it started: no box change here is a move. `resize` is the caller's — `resize()` for a write,
 * which turns a HUG / FILL axis FIXED like any other resize, or `resizeWithoutConstraints` for a
 * restore, which leaves the sizing modes to be restored on their own.
 *
 * Needs the node's fonts loaded, as every one of these writes does. A caller writing to a node
 * inside an instance checks {@link resizeTakes} first whenever {@link boxNeedsResize}.
 */
export const writeTextBox = (
  text: TextNode,
  box: TextBox,
  resize: (width: number, height: number) => void,
): void => {
  const anchor = inFlow(text) ? null : { x: text.x, y: text.y };

  if (box.autoResize === 'NONE') {
    fix(text, box.width, box.height, resize);
  } else {
    // Keeping the height keeps the mode and the clamp, and re-wraps at the new width.
    if (box.autoResize === 'HEIGHT' && !sameSize(text.width, box.width)) {
      resize(box.width, text.height);
    }
    if (text.textAutoResize !== box.autoResize) text.textAutoResize = box.autoResize;
  }

  if (text.textTruncation !== box.truncation) text.textTruncation = box.truncation;
  if (text.maxLines !== box.maxLines) {
    if (box.autoResize !== 'NONE' && box.truncation === 'ENDING') {
      text.maxLines = box.maxLines;
    } else {
      text.textTruncation = 'DISABLED';
      if (box.truncation === 'ENDING') text.textTruncation = 'ENDING';
    }
  }

  if (anchor !== null && (text.x !== anchor.x || text.y !== anchor.y)) {
    try {
      text.x = anchor.x;
      text.y = anchor.y;
    } catch {
      // Inside an instance the layer's position is not the plugin's to write (measured: the write
      // throws), and Figma re-derives it from the main component on the layer's next change.
    }
  }
};
