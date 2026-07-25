import { postToSandbox, sizeFromPointer } from '../lib/panel-window.js';

export interface PanelWindow {
  /** Hide the panel; the iframe (and with it the relay socket) stays alive. */
  runInBackground: () => void;
  onResizeStart: (e: PointerEvent) => void;
  onResizeMove: (e: PointerEvent) => void;
  onResizeEnd: (e: PointerEvent) => void;
}

const postResize = (clientX: number, clientY: number, persist: boolean): void => {
  const { width, height } = sizeFromPointer(clientX, clientY);
  postToSandbox({ type: 'ui:resize', width, height, persist });
};

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
    // The relay socket lives in this iframe, so ask the sandbox to figma.ui.hide() rather than
    // closing the plugin, which would drop the connection.
    runInBackground: () => postToSandbox({ type: 'ui:minimize' }),

    onResizeStart: (e: PointerEvent) => {
      resizing = true;
      // Capture keeps the drag alive when the pointer leaves the 14px grip.
      (e.target as Element).setPointerCapture(e.pointerId);
    },
    onResizeMove: (e: PointerEvent) => {
      if (resizing) postResize(e.clientX, e.clientY, false);
    },
    onResizeEnd: (e: PointerEvent) => {
      if (!resizing) return;
      resizing = false;
      postResize(e.clientX, e.clientY, true);
    },
  };
};
