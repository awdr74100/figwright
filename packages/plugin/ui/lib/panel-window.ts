/**
 * Panel window control — the messages this iframe sends to the sandbox to resize or hide itself.
 * Kept separate from the composable so the geometry is a pure function the tests can pin down.
 */

/** Floor for the plugin window; below this the header/footer layout starts to break. */
export const MIN_UI_WIDTH = 280;
export const MIN_UI_HEIGHT = 300;

/**
 * The grip sits at the bottom-right, so a drag's viewport coords are (≈) the desired window size —
 * plus a few px because the pointer sits inside the grip, not on the window edge.
 */
export const GRIP_OFFSET = 4;

export interface PanelSize {
  width: number;
  height: number;
}

/**
 * Clamp to the floor and drop sub-pixels. The sandbox clamps authoritatively as well; doing it here
 * too keeps the grip from running away past the floor while the pointer keeps moving.
 */
export const clampPanelSize = (width: number, height: number): PanelSize => ({
  width: Math.max(MIN_UI_WIDTH, Math.floor(width)),
  height: Math.max(MIN_UI_HEIGHT, Math.floor(height)),
});

/** Convert a pointer position during a drag into the window size it implies. */
export const sizeFromPointer = (clientX: number, clientY: number): PanelSize =>
  clampPanelSize(clientX + GRIP_OFFSET, clientY + GRIP_OFFSET);

type Parent = { postMessage: (message: unknown, targetOrigin: string) => void };

/**
 * Post a control message up to the sandbox (`code.ts` handles `ui:*` types locally rather than
 * routing them to tool dispatch). No-op when there is no parent frame, which is the case in tests.
 */
export const postToSandbox = (message: unknown): void => {
  (globalThis as { parent?: Parent }).parent?.postMessage({ pluginMessage: message }, '*');
};
