// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createPanelHide,
  createPanelResize,
  PANEL_MIN_SIZE,
  type PanelSize,
} from '../../protocol/panel-control.js';
import { usePanelWindow } from '../../ui/composables/usePanelWindow.js';
import { GRIP_OFFSET } from '../../ui/sandbox/commands.js';

const postMessage = vi.fn<(message: unknown, targetOrigin: string) => void>();

/**
 * A real element with a real drag on it.
 *
 * The previous version of this file passed a bare `{ setPointerCapture }` object as the event
 * target, which meant nothing here ever exercised the thing the drag actually depends on: whether
 * events keep arriving once the pointer has left the 16px grip. A real DOM makes that observable,
 * and it is the whole subject of this file.
 */
let grip: HTMLElement;
/**
 * The element the pointer actually lands on. The grip draws an svg, so a press hits a `<path>` or
 * the `<svg>` — never the div the handler sits on. Pressing the child is what makes `target` and
 * `currentTarget` different elements, and therefore what makes capturing on the wrong one visible.
 */
let mark: SVGElement;

const press = (clientX: number, clientY: number): void => {
  mark.dispatchEvent(
    new PointerEvent('pointerdown', { clientX, clientY, pointerId: 1, buttons: 1, bubbles: true }),
  );
};

/** Moves and releases go to `window`, which is where a drag that has left the grip lands. */
const move = (clientX: number, clientY: number, buttons = 1): void => {
  window.dispatchEvent(
    new PointerEvent('pointermove', { clientX, clientY, pointerId: 1, buttons }),
  );
};

const release = (clientX: number, clientY: number, type = 'pointerup'): void => {
  window.dispatchEvent(new PointerEvent(type, { clientX, clientY, pointerId: 1, buttons: 0 }));
};

const sentMessages = (): unknown[] =>
  postMessage.mock.calls.map(
    ([envelope]) => (envelope as { pluginMessage: unknown }).pluginMessage,
  );

const persisted = (): unknown[] =>
  sentMessages().filter(m => (m as { persist?: boolean }).persist === true);

const size = (clientX: number, clientY: number): PanelSize => ({
  width: clientX + GRIP_OFFSET,
  height: clientY + GRIP_OFFSET,
});

/** Start a drag on the grip, wired the way the component wires it. */
const startDrag = (clientX = 500, clientY = 600): void => {
  const { onResizeStart } = usePanelWindow();
  grip.addEventListener('pointerdown', e => onResizeStart(e as PointerEvent));
  press(clientX, clientY);
};

beforeEach(() => {
  postMessage.mockClear();
  vi.stubGlobal('parent', { postMessage });
  grip = document.createElement('div');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  mark = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  svg.append(mark);
  grip.append(svg);
  document.body.append(grip);
});

afterEach(() => {
  // End any drag a test left running. A live drag holds listeners on `window`, and `window` is the
  // one object these tests share — without this, a test that never releases makes the *next* one
  // see its moves too. (Dispatching one release ends every live drag at once, which is itself the
  // behaviour: the listeners are per-drag and each removes its own.)
  window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, buttons: 0 }));
  grip.remove();
  vi.unstubAllGlobals();
});

describe('usePanelWindow', () => {
  it('asks the sandbox to hide the panel rather than close the plugin', () => {
    usePanelWindow().runInBackground();

    // Closing would drop the relay socket that lives in this iframe.
    expect(sentMessages()).toEqual([createPanelHide()]);
  });

  describe('drag-to-resize', () => {
    it('ignores pointer movement that is not part of a drag', () => {
      usePanelWindow();

      move(500, 600);

      expect(postMessage).not.toHaveBeenCalled();
    });

    it('captures the pointer on the element that owns the handler, not the one under it', () => {
      // The press lands on the `<path>` the grip draws. Capturing there ties the drag to an element
      // the listeners do not belong to and that the component is free to re-render away; the div
      // they sit on is the one guaranteed to outlive the drag.
      const onGrip = vi.spyOn(grip, 'setPointerCapture').mockImplementation(() => {});
      const onMark = vi.spyOn(mark, 'setPointerCapture').mockImplementation(() => {});
      startDrag();

      expect(onGrip).toHaveBeenCalledWith(1);
      expect(onMark).not.toHaveBeenCalled();
    });

    it('streams sizes without persisting while dragging', () => {
      startDrag(500, 600);
      move(520, 620);

      expect(sentMessages()).toEqual([createPanelResize(size(520, 620), false)]);
    });

    it('persists exactly once, on release', () => {
      startDrag(500, 600);
      move(510, 610);
      move(520, 620);
      release(530, 630);

      expect(persisted()).toEqual([createPanelResize(size(530, 630), true)]);
    });

    it('keeps tracking after the pointer has left the grip', () => {
      // The whole point of tracking on `window`. A 16px target is one the pointer leaves on the
      // first move, so a drag bound to the grip only survives while capture holds.
      startDrag(500, 600);
      move(900, 900);
      move(1200, 1200);

      expect(sentMessages()).toEqual([
        createPanelResize(size(900, 900), false),
        createPanelResize(size(1200, 1200), false),
      ]);
    });

    it('drags on when the browser refuses to capture the pointer', () => {
      // Capture is a widening, not the mechanism. `setPointerCapture` can throw, and a drag that
      // stopped there would be the intermittent halfway-stop this rework exists to remove.
      vi.spyOn(grip, 'setPointerCapture').mockImplementation(() => {
        throw new Error('NotFoundError');
      });

      startDrag(500, 600);
      move(900, 900);
      release(950, 950);

      expect(persisted()).toEqual([createPanelResize(size(950, 950), true)]);
    });

    it('releases the capture it took', () => {
      vi.spyOn(grip, 'setPointerCapture').mockImplementation(() => {});
      const releaseCapture = vi.spyOn(grip, 'releasePointerCapture').mockImplementation(() => {});

      startDrag();
      release(700, 700);

      expect(releaseCapture).toHaveBeenCalledWith(1);
    });

    it('does not try to release a capture it never took', () => {
      vi.spyOn(grip, 'setPointerCapture').mockImplementation(() => {
        throw new Error('NotFoundError');
      });
      const releaseCapture = vi.spyOn(grip, 'releasePointerCapture').mockImplementation(() => {});

      startDrag();
      release(700, 700);

      expect(releaseCapture).not.toHaveBeenCalled();
    });

    it('survives a release that throws because the browser already released', () => {
      vi.spyOn(grip, 'setPointerCapture').mockImplementation(() => {});
      vi.spyOn(grip, 'releasePointerCapture').mockImplementation(() => {
        throw new Error('NotFoundError');
      });

      startDrag(500, 600);
      move(700, 700);
      expect(() => release(700, 700)).not.toThrow();
      expect(persisted()).toEqual([createPanelResize(size(700, 700), true)]);
    });

    it('stops tracking after release', () => {
      startDrag(500, 600);
      release(500, 600);
      postMessage.mockClear();

      move(700, 800);

      expect(postMessage).not.toHaveBeenCalled();
    });

    it('does not emit a stray persist when release arrives without a drag', () => {
      usePanelWindow();

      release(500, 600);

      expect(postMessage).not.toHaveBeenCalled();
    });

    it('holds the floor while the pointer keeps moving past it', () => {
      startDrag(500, 600);
      move(10, 10);

      expect(sentMessages()).toEqual([
        createPanelResize({ width: PANEL_MIN_SIZE.width, height: PANEL_MIN_SIZE.height }, false),
      ]);
    });

    it('ends the drag on a move that arrives with no button held', () => {
      // The release happened where this document could not see it — outside the iframe, or while
      // capture was lost out there. Without this the drag stays armed, and the next hover over the
      // corner resizes the window on its own.
      startDrag(500, 600);
      move(700, 700);
      postMessage.mockClear();

      move(900, 900, 0);
      move(1100, 1100);

      // Nothing was asked for by either move, and the size last actually dragged to is what stuck.
      expect(sentMessages()).toEqual([createPanelResize(size(700, 700), true)]);
    });

    it('keeps the size the drag reached when the gesture is cancelled', () => {
      // A cancel's coordinates are wherever the gesture was interrupted, not a size anyone chose.
      startDrag(500, 600);
      move(700, 700);
      release(20, 20, 'pointercancel');

      expect(persisted()).toEqual([createPanelResize(size(700, 700), true)]);
    });

    it('stores nothing for a press that never moved', () => {
      // A click on the grip. Taking the release position would nudge the window by however far the
      // press sat from the corner.
      startDrag(500, 600);
      release(500, 600);

      expect(postMessage).not.toHaveBeenCalled();
    });

    it('ignores a second press while a drag is already running', () => {
      const { onResizeStart } = usePanelWindow();
      grip.addEventListener('pointerdown', e => onResizeStart(e as PointerEvent));

      press(500, 600);
      move(700, 700);
      press(500, 600);
      release(800, 800);

      // One drag, one persist — a re-entrant start must not double the window listeners.
      expect(persisted()).toEqual([createPanelResize(size(800, 800), true)]);
    });
  });
});
