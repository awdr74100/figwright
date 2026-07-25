// @vitest-environment happy-dom
import { createPluginContextEvent, createToolResult } from '@figwright/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPanelHide } from '../../protocol/panel-control.js';
import { onSandboxContext, onSandboxMessage, postToSandbox } from '../../ui/sandbox/messaging.js';

const postMessage = vi.fn<(message: unknown, targetOrigin: string) => void>();

const context = createPluginContextEvent({
  fileName: 'Design File',
  pageId: 'page-1',
  pageName: 'Page 1',
  selectionCount: 0,
  selection: [],
  editorType: 'figma',
  apiVersion: '1.0.0',
});

/** Deliver a message the way the sandbox does — wrapped in its envelope. */
const deliver = (pluginMessage: unknown): void => {
  globalThis.dispatchEvent(new MessageEvent('message', { data: { pluginMessage } }));
};

describe('postToSandbox', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('wraps the message in a pluginMessage envelope', () => {
    vi.stubGlobal('parent', { postMessage });

    postToSandbox(createPanelHide());

    expect(postMessage).toHaveBeenCalledWith({ pluginMessage: createPanelHide() }, '*');
  });

  // The panel also renders in contexts without a parent frame (tests, a plain browser tab); a
  // missing parent must not throw and take the whole UI down.
  it('is a no-op when there is no parent frame', () => {
    vi.stubGlobal('parent', undefined);

    expect(() => postToSandbox(createPanelHide())).not.toThrow();
  });
});

describe('onSandboxMessage', () => {
  const stops: Array<() => void> = [];

  beforeEach(() => {
    stops.length = 0;
  });

  afterEach(() => {
    while (stops.length > 0) stops.pop()?.();
  });

  const listen = (): ReturnType<typeof vi.fn> => {
    const listener = vi.fn<(message: unknown) => void>();
    stops.push(onSandboxMessage(listener));
    return listener;
  };

  it('unwraps the envelope before handing the message over', () => {
    const listener = listen();

    deliver({ hello: true });

    expect(listener).toHaveBeenCalledWith({ hello: true });
  });

  // Figma's own iframe traffic shares this window; anything without the envelope isn't ours.
  it('ignores messages that carry no pluginMessage', () => {
    const listener = listen();

    globalThis.dispatchEvent(new MessageEvent('message', { data: { other: 1 } }));
    globalThis.dispatchEvent(new MessageEvent('message', { data: null }));
    globalThis.dispatchEvent(new MessageEvent('message', { data: 'a string' }));

    expect(listener).not.toHaveBeenCalled();
  });

  // An explicitly-null payload is still a message from our sandbox, so it is delivered as-is and
  // left for the channel's own validator to reject.
  it('delivers a null payload that was explicitly sent', () => {
    const listener = listen();

    deliver(null);

    expect(listener).toHaveBeenCalledWith(null);
  });

  it('stops delivering once unsubscribed', () => {
    const listener = vi.fn<(message: unknown) => void>();
    const stop = onSandboxMessage(listener);

    stop();
    deliver({ hello: true });

    expect(listener).not.toHaveBeenCalled();
  });
});

describe('onSandboxContext', () => {
  const stops: Array<() => void> = [];

  afterEach(() => {
    while (stops.length > 0) stops.pop()?.();
  });

  const listen = (): ReturnType<typeof vi.fn> => {
    const listener = vi.fn<(event: unknown) => void>();
    stops.push(onSandboxContext(listener));
    return listener;
  };

  it('delivers context pushes', () => {
    const listener = listen();

    deliver(context);

    expect(listener).toHaveBeenCalledWith(context);
  });

  // The tool bridge shares this window and validates its own traffic; each subscriber must pass
  // over the other's messages rather than treat them as malformed.
  it('ignores tool traffic and anything else on the wire', () => {
    const listener = listen();

    deliver(createToolResult({ id: 'req-1', result: { ok: true } }));
    deliver({ tag: '@figwright/bridge', kind: 'context' });
    deliver('not an object');

    expect(listener).not.toHaveBeenCalled();
  });
});
