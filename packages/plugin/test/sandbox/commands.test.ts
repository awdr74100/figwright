import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createPanelHide,
  createPanelResize,
  createPanelReveal,
  PANEL_MIN_SIZE,
} from '../../protocol/panel-control.js';
import {
  GRIP_OFFSET,
  hidePanel,
  resizePanel,
  revealOnCanvas,
  sizeFromPointer,
} from '../../ui/sandbox/commands.js';

const postMessage = vi.fn<(message: unknown, targetOrigin: string) => void>();

const sent = (): unknown[] =>
  postMessage.mock.calls.map(
    ([envelope]) => (envelope as { pluginMessage: unknown }).pluginMessage,
  );

describe('sandbox commands', () => {
  beforeEach(() => {
    postMessage.mockClear();
    vi.stubGlobal('parent', { postMessage });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('sizeFromPointer', () => {
    it('adds the grip offset so the window edge lands under the pointer', () => {
      expect(sizeFromPointer(500, 600)).toEqual({
        width: 500 + GRIP_OFFSET,
        height: 600 + GRIP_OFFSET,
      });
    });

    it('still respects the floor after the offset', () => {
      expect(sizeFromPointer(0, 0)).toEqual(PANEL_MIN_SIZE);
    });

    it('drops sub-pixels so the sandbox never gets a fractional size', () => {
      expect(sizeFromPointer(400.9, 500.2)).toEqual({
        width: 400 + GRIP_OFFSET,
        height: 500 + GRIP_OFFSET,
      });
    });
  });

  // Closing would drop the relay socket that lives in this iframe.
  describe('hidePanel', () => {
    it('asks the sandbox to hide rather than close', () => {
      hidePanel();

      expect(sent()).toEqual([createPanelHide()]);
    });
  });

  describe('resizePanel', () => {
    it('carries the size and whether to store it', () => {
      resizePanel({ width: 400, height: 500 }, true);

      expect(sent()).toEqual([createPanelResize({ width: 400, height: 500 }, true)]);
    });
  });

  describe('revealOnCanvas', () => {
    it('asks the sandbox to reveal the given nodes', () => {
      revealOnCanvas(['1:1', '2:2']);

      expect(sent()).toEqual([createPanelReveal(['1:1', '2:2'])]);
    });

    // Nothing to frame, so don't make the sandbox surface a "nodes are gone" notice.
    it('stays silent when there is nothing to reveal', () => {
      revealOnCanvas([]);

      expect(postMessage).not.toHaveBeenCalled();
    });

    // The entry's ids are readonly state; the message must not carry a live reference to them.
    it('sends a copy of the ids rather than the caller’s array', () => {
      const ids = ['1:1'];
      revealOnCanvas(ids);

      const [message] = sent() as [{ nodeIds: string[] }];
      expect(message.nodeIds).toEqual(['1:1']);
      expect(message.nodeIds).not.toBe(ids);
    });
  });
});
