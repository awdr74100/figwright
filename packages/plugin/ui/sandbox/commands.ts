/**
 * The named commands the panel can issue to the sandbox — one function per thing the user can do to
 * the window or the canvas, so call sites read as intent rather than as message construction.
 *
 * The window's floor and its clamping rule are not here: they belong to both ends of the channel
 * and live in `protocol/panel-control.ts`. What is here is the part only the panel knows — how a
 * pointer position during a drag becomes a size.
 */

import {
  clampPanelSize,
  createPanelHide,
  createPanelResize,
  createPanelReveal,
  type PanelSize,
} from '../../protocol/panel-control.js';
import { postToSandbox } from './messaging.js';

/**
 * The grip sits in the bottom-right corner, so a drag's viewport coordinates are (≈) the window
 * size being asked for — plus a few px, because the pointer sits inside the 16px grip rather than
 * on the window edge itself.
 */
export const GRIP_OFFSET = 4;

/** Convert a pointer position during a drag into the window size it implies. */
export const sizeFromPointer = (clientX: number, clientY: number): PanelSize =>
  clampPanelSize(clientX + GRIP_OFFSET, clientY + GRIP_OFFSET);

/** Hide the panel; the iframe — and the relay socket inside it — stays alive. */
export const hidePanel = (): void => postToSandbox(createPanelHide());

/** Resize the window. `persist` is set once, on drag-release, so only the final size is stored. */
export const resizePanel = (size: PanelSize, persist: boolean): void =>
  postToSandbox(createPanelResize(size, persist));

/**
 * Ask the sandbox to select and frame these nodes. Fire-and-forget: the sandbox owns the document
 * and reports a miss to the user itself, so there is nothing to await here.
 */
export const revealOnCanvas = (nodeIds: readonly string[]): void => {
  // Nothing to frame — and asking anyway would make the sandbox surface a "nodes are gone" notice
  // for a request that named no nodes in the first place.
  if (nodeIds.length === 0) return;
  postToSandbox(createPanelReveal(nodeIds));
};
