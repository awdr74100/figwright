import { afterEach, describe, expect, it } from 'vitest';

import type { PluginSessionInfo } from '../../src/routing/sessions.js';
import {
  bindFileTarget,
  clearFileTarget,
  FileTargetError,
  getFileTarget,
  resolveFileTarget,
} from '../../src/routing/target.js';

const session = (id: string, fileName: string | null, pageName = 'Page 1'): PluginSessionInfo => ({
  id,
  fileName,
  pageName,
  lastActivityAt: 1,
  pluginVersion: '0.5.0',
});

const source =
  (...sessions: PluginSessionInfo[]) =>
  async (): Promise<readonly PluginSessionInfo[]> =>
    sessions;

/**
 * ResolveFileTarget takes a free source and a probing one. Here they are the same fixture: these
 * cases are about the resolution ladder, and the split between the two sources is exercised where
 * it matters (dispatch.test.ts asserts the free path costs no dispatch).
 */
const resolveFileTargetWith = (src: ReturnType<typeof source>): Promise<string | undefined> =>
  resolveFileTarget(src, src);

afterEach(() => {
  clearFileTarget();
});

describe('bindFileTarget', () => {
  it('binds by file name, case- and whitespace-insensitively', async () => {
    const { target } = await bindFileTarget(source(session('s-1', 'Design System')), {
      fileName: '  design system ',
    });
    expect(target).toEqual({ sessionId: 's-1', fileName: 'Design System' });
    expect(getFileTarget()).toEqual(target);
  });

  it('binds by session id even when the file has no name yet', async () => {
    // A panel opened while its tab was in the background has sent no $activity, so the server has
    // no name for it — and it is exactly the session a second agent needs to claim.
    const { target } = await bindFileTarget(source(session('s-2', null)), { sessionId: 's-2' });
    expect(target).toEqual({ sessionId: 's-2', fileName: null });
  });

  it('refuses a name two open files answer to, and names the sessions instead', async () => {
    // The case the whole two-handle design exists for: duplicate names are legal in Figma and
    // "x (Copy)" is how users make them. Guessing here would silently pick the wrong file.
    await expect(
      bindFileTarget(source(session('s-1', 'Brand'), session('s-2', 'Brand')), {
        fileName: 'Brand',
      }),
    ).rejects.toThrow(/matches 2 open files/);
    expect(getFileTarget()).toBeNull();
  });

  it('refuses a name nothing is open under, listing what is', async () => {
    await expect(
      bindFileTarget(source(session('s-1', 'Brand')), { fileName: 'Nope' }),
    ).rejects.toThrow(/no connected file named "Nope".*Brand \[s-1]/s);
  });

  it('refuses a session id that is not connected', async () => {
    await expect(
      bindFileTarget(source(session('s-1', 'Brand')), { sessionId: 's-9' }),
    ).rejects.toThrow(/no connected session s-9/);
  });

  it('refuses when nothing is connected at all', async () => {
    await expect(bindFileTarget(source(), { fileName: 'Brand' })).rejects.toThrow(
      /no Figma file is connected/,
    );
  });

  it('refuses with neither handle', async () => {
    await expect(bindFileTarget(source(session('s-1', 'Brand')), {})).rejects.toThrow(
      /needs either fileName or sessionId/,
    );
  });
});

describe('resolveFileTarget', () => {
  it('is undefined when nothing is bound, so routing stays as it was', async () => {
    // The single-agent default. Follow-the-foreground must be untouched by this module existing.
    expect(await resolveFileTargetWith(source(session('s-1', 'Brand')))).toBeUndefined();
  });

  it('returns the bound session while it is still connected', async () => {
    await bindFileTarget(source(session('s-1', 'Brand'), session('s-2', 'Other')), {
      fileName: 'Brand',
    });
    expect(
      await resolveFileTargetWith(source(session('s-1', 'Brand'), session('s-2', 'Other'))),
    ).toBe('s-1');
  });

  it('adopts the new session when the panel was reopened under the same name', async () => {
    await bindFileTarget(source(session('s-1', 'Brand')), { fileName: 'Brand' });
    // Same file, new panel: the plugin generates a fresh session id, so the id alone would break.
    expect(await resolveFileTargetWith(source(session('s-9', 'Brand')))).toBe('s-9');
    expect(getFileTarget()).toEqual({ sessionId: 's-9', fileName: 'Brand' });
  });

  it('throws rather than falling back when the bound file is gone', async () => {
    await bindFileTarget(source(session('s-1', 'Brand')), { fileName: 'Brand' });
    // The whole point: another file is connected and is NOT an acceptable substitute.
    await expect(resolveFileTargetWith(source(session('s-2', 'Other')))).rejects.toThrow(
      /"Brand" is no longer connected.*Other \[s-2]/s,
    );
    await expect(resolveFileTargetWith(source(session('s-2', 'Other')))).rejects.toBeInstanceOf(
      FileTargetError,
    );
  });

  it('throws when a reopened panel is no longer identifiable by name', async () => {
    await bindFileTarget(source(session('s-1', 'Brand')), { fileName: 'Brand' });
    await expect(
      resolveFileTargetWith(source(session('s-2', 'Brand'), session('s-3', 'Brand'))),
    ).rejects.toThrow(/matches 2 open files/);
  });

  it('throws when a bound-by-id session vanishes with no name to recover by', async () => {
    await bindFileTarget(source(session('s-2', null)), { sessionId: 's-2' });
    await expect(resolveFileTargetWith(source(session('s-1', 'Brand')))).rejects.toThrow(
      /never reported a file name/,
    );
  });
});
