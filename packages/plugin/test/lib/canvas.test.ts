import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { revealOnCanvas } from '../../ui/lib/canvas.js';

const postMessage = vi.fn<(message: unknown, targetOrigin: string) => void>();

const sent = (): unknown[] =>
  postMessage.mock.calls.map(
    ([envelope]) => (envelope as { pluginMessage: unknown }).pluginMessage,
  );

describe('revealOnCanvas', () => {
  beforeEach(() => {
    postMessage.mockClear();
    vi.stubGlobal('parent', { postMessage });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks the sandbox to reveal the given nodes', () => {
    revealOnCanvas(['1:1', '2:2']);

    expect(sent()).toEqual([{ type: 'ui:reveal', nodeIds: ['1:1', '2:2'] }]);
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
