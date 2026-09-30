import type { ListFilesResult } from '@figwright/shared';
import { afterEach, describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';

import { dispatchTargeted } from '../../src/dispatch.js';
import { getFileTarget, setFileTarget } from '../../src/routing/target.js';
import {
  closeSocket,
  connectFakePlugin,
  type LeaderHarness,
  startLeader,
  stopLeader,
} from './_helpers.js';

// A plugin reload — the user closing and reopening the panel, or Figma reloading a development build
// — ends one plugin run and starts another under a new session id, in the same file. An agent that
// has claimed that file must reach the new run on its very next call. Measured before the fix: the
// call was held for the old session's reconnect grace window, which no reload ever ends, and failed
// after 35s while the reloaded plugin had been connected for 15.

const harnesses: LeaderHarness[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const ws of sockets) closeSocket(ws);
  sockets.length = 0;
  setFileTarget(null);
  await Promise.all(harnesses.map(stopLeader));
  harnesses.length = 0;
});

const plugin = (port: number, sessionId: string, fileName: string) =>
  connectFakePlugin({
    port,
    sessionId,
    handlers: {
      list_files: (): ListFilesResult => ({
        files: [{ fileKey: null, fileName, currentPage: { id: '0:1', name: 'Page 1' } }],
      }),
      get_pages: () => ({ servedBy: sessionId }),
    },
  });

const closed = (ws: WebSocket, code: number): Promise<void> =>
  new Promise(resolve => {
    ws.once('close', () => resolve());
    ws.close(code);
  });

describe('e2e: a claimed file across a plugin reload', () => {
  it('serves the first call after the reload from the new plugin run, at once', async () => {
    const h = await startLeader();
    harnesses.push(h);
    const before = await plugin(h.port, 'run-1', 'Demo');
    sockets.push(before);
    setFileTarget({ sessionId: 'run-1', fileName: 'Demo' });

    // What Figma's unloading page sends, measured on every reload observed.
    await closed(before, 1001);
    sockets.push(await plugin(h.port, 'run-2', 'Demo'));

    const started = Date.now();
    const result = await dispatchTargeted({ node: h.node, follower: h.follower }, 'get_pages', {});

    expect(result).toEqual({ servedBy: 'run-2' });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(getFileTarget()).toEqual({ sessionId: 'run-2', fileName: 'Demo' });
  });

  it('still refuses to follow a same-named file when the claimed one is gone for good', async () => {
    const h = await startLeader();
    harnesses.push(h);
    const before = await plugin(h.port, 'run-1', 'Demo');
    sockets.push(before);
    setFileTarget({ sessionId: 'run-1', fileName: 'Demo' });
    await closed(before, 1001);
    // Two other files that share the claimed name: the name alone cannot pick one.
    sockets.push(await plugin(h.port, 'other-a', 'Demo'));
    sockets.push(await plugin(h.port, 'other-b', 'Demo'));

    await expect(
      dispatchTargeted({ node: h.node, follower: h.follower }, 'get_pages', {}),
    ).rejects.toThrow(/"Demo" now matches 2 open files/);
  });
});
