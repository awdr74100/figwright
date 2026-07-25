import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clampPanelSize,
  GRIP_OFFSET,
  MIN_UI_HEIGHT,
  MIN_UI_WIDTH,
  postToSandbox,
  sizeFromPointer,
} from '../../ui/lib/panel-window.js';

describe('clampPanelSize', () => {
  it('holds the floor when a drag goes below it', () => {
    expect(clampPanelSize(10, 10)).toEqual({ width: MIN_UI_WIDTH, height: MIN_UI_HEIGHT });
  });

  it('keeps the exact floor value', () => {
    expect(clampPanelSize(MIN_UI_WIDTH, MIN_UI_HEIGHT)).toEqual({
      width: MIN_UI_WIDTH,
      height: MIN_UI_HEIGHT,
    });
  });

  it('drops sub-pixels so the sandbox never gets a fractional size', () => {
    expect(clampPanelSize(400.9, 500.2)).toEqual({ width: 400, height: 500 });
  });

  it('clamps each axis independently', () => {
    expect(clampPanelSize(1000, 10)).toEqual({ width: 1000, height: MIN_UI_HEIGHT });
    expect(clampPanelSize(10, 1000)).toEqual({ width: MIN_UI_WIDTH, height: 1000 });
  });
});

describe('sizeFromPointer', () => {
  it('adds the grip offset so the window edge lands under the pointer', () => {
    expect(sizeFromPointer(500, 600)).toEqual({
      width: 500 + GRIP_OFFSET,
      height: 600 + GRIP_OFFSET,
    });
  });

  it('still respects the floor after the offset', () => {
    expect(sizeFromPointer(0, 0)).toEqual({ width: MIN_UI_WIDTH, height: MIN_UI_HEIGHT });
  });
});

describe('postToSandbox', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('wraps the message in a pluginMessage envelope', () => {
    const postMessage = vi.fn<(message: unknown, targetOrigin: string) => void>();
    vi.stubGlobal('parent', { postMessage });

    postToSandbox({ type: 'ui:minimize' });

    expect(postMessage).toHaveBeenCalledWith({ pluginMessage: { type: 'ui:minimize' } }, '*');
  });

  // The panel also renders in contexts without a parent frame (tests, a plain browser tab); a
  // missing parent must not throw and take the whole UI down.
  it('is a no-op when there is no parent frame', () => {
    vi.stubGlobal('parent', undefined);
    expect(() => postToSandbox({ type: 'ui:minimize' })).not.toThrow();
  });
});
