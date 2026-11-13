import { describe, expect, it } from 'vitest';

import { readTracks, resetGridTrackReadsForTests, TRACKS_UNREAD } from '../src/grid-tracks.js';

const SPENT = 'in <unknown>: Attempted to invoke callback with invalid id -32761';

describe('readTracks', () => {
  it('reads as many times as asked while the runtime has callback ids left', () => {
    resetGridTrackReadsForTests();
    for (let i = 0; i < 10_000; i++) expect(readTracks(() => i)).toBe(i);
  });

  // Measured: past the overflow every track read spends more ids, and a wrapped counter calls
  // unrelated Figma APIs — so the first refusal is the last read this session makes.
  it('stops for the rest of the session once the runtime reports its ids spent', () => {
    resetGridTrackReadsForTests();
    expect(
      readTracks(() => {
        throw new Error(SPENT);
      }),
    ).toBe(TRACKS_UNREAD);
    let ran = false;
    expect(
      readTracks(() => {
        ran = true;
        return 'read';
      }),
    ).toBe(TRACKS_UNREAD);
    expect(ran).toBe(false);
    resetGridTrackReadsForTests();
  });

  it('rethrows any other error and keeps reading after it', () => {
    resetGridTrackReadsForTests();
    expect(() =>
      readTracks(() => {
        throw new Error('nope');
      }),
    ).toThrow('nope');
    expect(readTracks(() => 'read')).toBe('read');
  });
});
