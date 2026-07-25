import { hidePanel, resizePanel, sizeFromPointer } from '../sandbox/commands.js';

export interface PanelWindow {
  /** Hide the panel; the iframe (and with it the relay socket) stays alive. */
  runInBackground: () => void;
  onResizeStart: (e: PointerEvent) => void;
  onResizeMove: (e: PointerEvent) => void;
  onResizeEnd: (e: PointerEvent) => void;
}

const sendSize = (e: PointerEvent, persist: boolean): void =>
  resizePanel(sizeFromPointer(e.clientX, e.clientY), persist);

/**
 * Drag-to-resize and run-in-background, as the small state machine they are.
 *
 * Resize only tracks between pointerdown and pointerup — without that flag every stray pointermove
 * over the grip would resize the window. `persist` is sent once on release so the sandbox stores
 * the final size rather than every intermediate frame.
 */
export const usePanelWindow = (): PanelWindow => {
  let resizing = false;

  return {
    runInBackground: hidePanel,

    onResizeStart: (e: PointerEvent) => {
      resizing = true;
      // Capture keeps the drag alive when the pointer leaves the 16px grip.
      (e.target as Element).setPointerCapture(e.pointerId);
    },
    onResizeMove: (e: PointerEvent) => {
      if (resizing) sendSize(e, false);
    },
    onResizeEnd: (e: PointerEvent) => {
      if (!resizing) return;
      resizing = false;
      sendSize(e, true);
    },
  };
};
