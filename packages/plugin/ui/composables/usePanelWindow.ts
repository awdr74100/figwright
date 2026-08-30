import type { PanelSize } from '../../protocol/panel-control.js';
import { hidePanel, resizePanel, sizeFromPointer } from '../sandbox/commands.js';

export interface PanelWindow {
  /** Hide the panel; the iframe (and with it the relay socket) stays alive. */
  runInBackground: () => void;
  /** Begin a resize drag. The rest of the drag is tracked on `window`, not on the grip. */
  onResizeStart: (e: PointerEvent) => void;
}

/**
 * Drag-to-resize and run-in-background, as the small state machine they are.
 *
 * The drag is tracked on `window` for its duration rather than on the grip, because the grip is
 * 16px and the pointer leaves it immediately. Pointer capture is still taken, but as a widening
 * rather than as the mechanism: the two cover different halves of the same problem, and only
 * together do they cover all of it.
 *
 * - Capture is what keeps events coming to this document once the pointer leaves the _iframe_.
 *   Nothing else can do that; a listener on `window` is still a listener inside a document the
 *   pointer is no longer over.
 * - The `window` listeners are what keep the drag working if capture is never established or is lost
 *   mid-drag. Capture is not guaranteed: `setPointerCapture` can throw, and the browser drops
 *   capture on its own (the captured element being re-rendered away is enough).
 *
 * Depending on capture alone is what makes a resize drag stop halfway: the moment the pointer is
 * outside the grip with no capture, no further `pointermove` reaches the handler — and neither does
 * the `pointerup`, so the drag stays armed and the _next_ hover over the corner resizes the window.
 * That failure is intermittent by nature, which is exactly why the drag should not rest on it.
 *
 * The missed release is handled directly rather than inferred: a `pointermove` that arrives with no
 * button held is a release this document never saw, and ends the drag. It subsumes every way the
 * release can go missing — let go outside the iframe, capture lost while out there, the grip
 * unmounted mid-drag — without needing to tell them apart.
 *
 * `persist` is sent once, on release, so the sandbox stores the final size rather than every
 * intermediate frame — and what it stores is the last size the drag actually asked for. A cancel's
 * coordinates are not that: they are wherever the gesture was interrupted, which is not a size the
 * user chose. A press that never moved asked for no size at all, so it stores nothing.
 */
export const usePanelWindow = (): PanelWindow => {
  let dragging = false;
  /** The last size this drag asked for; null until the pointer has actually moved. */
  let lastSize: PanelSize | null = null;
  /** Set only when capture was actually taken, so the release can be undone exactly once. */
  let captured: { element: Element; pointerId: number } | null = null;

  const finish = (): void => {
    if (!dragging) return;
    dragging = false;

    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', finish);

    if (captured !== null) {
      try {
        captured.element.releasePointerCapture(captured.pointerId);
      } catch {
        // Already released — the browser does it itself on pointerup. Releasing is only load-bearing
        // on the paths where no pointerup arrived.
      }
      captured = null;
    }

    if (lastSize !== null) resizePanel(lastSize, true);
    lastSize = null;
  };

  const onMove = (e: PointerEvent): void => {
    // No button held: the release happened somewhere this document could not see it.
    if (e.buttons === 0) {
      finish();
      return;
    }
    lastSize = sizeFromPointer(e.clientX, e.clientY);
    resizePanel(lastSize, false);
  };

  const onUp = (e: PointerEvent): void => {
    // The release position is the size the user settled on — but only for a drag that moved. A
    // press and release on the grip is a click, and taking its position would nudge the window by
    // however far the press sat from the corner.
    if (lastSize !== null) lastSize = sizeFromPointer(e.clientX, e.clientY);
    finish();
  };

  return {
    runInBackground: hidePanel,

    onResizeStart: (e: PointerEvent): void => {
      if (dragging) return;
      dragging = true;
      lastSize = null;

      // `currentTarget`, not `target`: the grip draws an svg, so the element under the pointer is a
      // `<path>` or the `<svg>`, while the element that owns these listeners — and is guaranteed to
      // outlive the drag — is the div they sit on.
      const host = e.currentTarget;
      if (host instanceof Element) {
        try {
          host.setPointerCapture(e.pointerId);
          captured = { element: host, pointerId: e.pointerId };
        } catch {
          // A widening that did not apply, not a failure: the window listeners below are the drag.
          captured = null;
        }
      }

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', finish);
    },
  };
};
