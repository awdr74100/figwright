import type { ListFilesResult } from '@figwright/shared';
import { afterEach, describe, expect, it } from 'vitest';

import type { PluginSessionInfo } from '../../src/routing/sessions.js';
import { clearFileTarget, getFileTarget } from '../../src/routing/target.js';
import type { SessionDispatch } from '../../src/tools/list-files.js';
import { handleUseFile } from '../../src/tools/use-file.js';

const session = (id: string, fileName: string | null): PluginSessionInfo => ({
  id,
  fileName,
  pageName: null,
  lastActivityAt: 1,
  pluginVersion: '0.5.0',
});

const plugins =
  (byId: Record<string, string>): SessionDispatch =>
  async (sessionId): Promise<ListFilesResult> => ({
    files: [
      {
        fileKey: null,
        fileName: byId[sessionId] ?? '?',
        currentPage: { id: 'p1', name: 'Page 1' },
      },
    ],
  });

afterEach(() => {
  clearFileTarget();
});

describe('handleUseFile', () => {
  it('claims a file the relay has no name for yet', async () => {
    // The bug this exists for, caught live. `$activity` is gated on tab visibility, so a session
    // reports its file only after its own tab has been in front and the user has touched something.
    // A session that just connected has reported nothing — and every leader handover and server
    // restart reconnects every plugin, so this is the state right after a restart, not a rarity.
    // Matching against the relay's cache there answers "no connected file named X" for a file that
    // is plainly open. Only the plugins themselves know.
    const sessions = [session('s-1', null), session('s-2', null)];
    const result = await handleUseFile(
      { fileName: 'Marketing' },
      async () => sessions,
      plugins({ 's-1': 'Brand', 's-2': 'Marketing' }),
    );
    expect(result.bound).toEqual({ sessionId: 's-2', fileName: 'Marketing' });
    expect(getFileTarget()?.sessionId).toBe('s-2');
  });

  it('records the real file name when claiming by session id', async () => {
    // The name is the recovery handle, so a claim that stored null would not survive a panel
    // reopen — the id changes and nothing is left to match on.
    const result = await handleUseFile(
      { sessionId: 's-2' },
      async () => [session('s-1', null), session('s-2', null)],
      plugins({ 's-1': 'Brand', 's-2': 'Marketing' }),
    );
    expect(result.bound).toEqual({ sessionId: 's-2', fileName: 'Marketing' });
  });

  it('reports without claiming when given no arguments', async () => {
    const result = await handleUseFile(
      {},
      async () => [session('s-1', 'Brand')],
      plugins({ 's-1': 'Brand' }),
    );
    expect(result.bound).toBeNull();
    expect(result.files.map(f => f.fileName)).toEqual(['Brand']);
  });

  it('releases the claim', async () => {
    const sessions = [session('s-1', 'Brand'), session('s-2', 'Marketing')];
    const dispatch = plugins({ 's-1': 'Brand', 's-2': 'Marketing' });
    await handleUseFile({ fileName: 'Marketing' }, async () => sessions, dispatch);
    const result = await handleUseFile({ release: true }, async () => sessions, dispatch);
    expect(result.bound).toBeNull();
    expect(getFileTarget()).toBeNull();
  });

  it('leaves the previous claim in place when a new one is refused', async () => {
    // A failed re-claim must not silently drop the working one and fall back to the foreground.
    const sessions = [session('s-1', 'Brand'), session('s-2', 'Marketing')];
    const dispatch = plugins({ 's-1': 'Brand', 's-2': 'Marketing' });
    await handleUseFile({ fileName: 'Marketing' }, async () => sessions, dispatch);
    await expect(
      handleUseFile({ fileName: 'Nope' }, async () => sessions, dispatch),
    ).rejects.toThrow(/no connected file named "Nope"/);
    expect(getFileTarget()).toEqual({ sessionId: 's-2', fileName: 'Marketing' });
  });
});
