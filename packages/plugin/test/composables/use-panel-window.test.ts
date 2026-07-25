import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createPanelHide,
  createPanelResize,
  PANEL_MIN_SIZE,
} from '../../protocol/panel-control.js';
import { usePanelWindow } from '../../ui/composables/usePanelWindow.js';
import { GRIP_OFFSET } from '../../ui/sandbox/commands.js';

const postMessage = vi.fn<(message: unknown, targetOrigin: string) => void>();

/** A pointer event carries only what the resize handlers actually read. */
const pointerAt = (clientX: number, clientY: number): PointerEvent =>
  ({
    clientX,
    clientY,
    pointerId: 1,
    target: { setPointerCapture: vi.fn<(id: number) => void>() },
  }) as unknown as PointerEvent;

const sentMessages = (): unknown[] =>
  postMessage.mock.calls.map(
    ([envelope]) => (envelope as { pluginMessage: unknown }).pluginMessage,
  );

describe('usePanelWindow', () => {
  beforeEach(() => {
    postMessage.mockClear();
    vi.stubGlobal('parent', { postMessage });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks the sandbox to hide the panel rather than close the plugin', () => {
    usePanelWindow().runInBackground();

    // Closing would drop the relay socket that lives in this iframe.
    expect(sentMessages()).toEqual([createPanelHide()]);
  });

  describe('drag-to-resize', () => {
    it('ignores pointer movement that is not part of a drag', () => {
      const { onResizeMove } = usePanelWindow();

      onResizeMove(pointerAt(500, 600));

      expect(postMessage).not.toHaveBeenCalled();
    });

    it('captures the pointer on drag start so the drag survives leaving the grip', () => {
      const { onResizeStart } = usePanelWindow();
      const event = pointerAt(500, 600);

      onResizeStart(event);

      expect(
        (event.target as unknown as { setPointerCapture: ReturnType<typeof vi.fn> })
          .setPointerCapture,
      ).toHaveBeenCalledWith(1);
    });

    it('streams sizes without persisting while dragging', () => {
      const { onResizeStart, onResizeMove } = usePanelWindow();

      onResizeStart(pointerAt(500, 600));
      onResizeMove(pointerAt(520, 620));

      expect(sentMessages()).toEqual([
        createPanelResize({ width: 520 + GRIP_OFFSET, height: 620 + GRIP_OFFSET }, false),
      ]);
    });

    it('persists exactly once, on release', () => {
      const { onResizeStart, onResizeMove, onResizeEnd } = usePanelWindow();

      onResizeStart(pointerAt(500, 600));
      onResizeMove(pointerAt(510, 610));
      onResizeMove(pointerAt(520, 620));
      onResizeEnd(pointerAt(530, 630));

      const persisted = sentMessages().filter(m => (m as { persist: boolean }).persist);
      expect(persisted).toEqual([
        createPanelResize({ width: 530 + GRIP_OFFSET, height: 630 + GRIP_OFFSET }, true),
      ]);
    });

    it('stops tracking after release', () => {
      const { onResizeStart, onResizeEnd, onResizeMove } = usePanelWindow();
      onResizeStart(pointerAt(500, 600));
      onResizeEnd(pointerAt(500, 600));
      postMessage.mockClear();

      onResizeMove(pointerAt(700, 800));

      expect(postMessage).not.toHaveBeenCalled();
    });

    it('does not emit a stray persist when release arrives without a drag', () => {
      const { onResizeEnd } = usePanelWindow();

      onResizeEnd(pointerAt(500, 600));

      expect(postMessage).not.toHaveBeenCalled();
    });

    it('holds the floor while the pointer keeps moving past it', () => {
      const { onResizeStart, onResizeMove } = usePanelWindow();

      onResizeStart(pointerAt(500, 600));
      onResizeMove(pointerAt(10, 10));

      expect(sentMessages()).toEqual([
        createPanelResize({ width: PANEL_MIN_SIZE.width, height: PANEL_MIN_SIZE.height }, false),
      ]);
    });
  });
});
