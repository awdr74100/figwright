import type { SerializedGridTrack } from '@figwright/shared';

/**
 * Figma's plugin runtime numbers its host callbacks from one signed 16-bit counter that never
 * reuses an id, and some of the objects it hands out spend ids just by existing: a GridTrackSize
 * carries its own native get/set pair for `type` and `value`, minted with the object. Measured in
 * Figma desktop (macOS; it reproduces the Windows report in issue #367 exactly): reading
 * `gridRowSizes` / `gridColumnSizes` costs 1.2 ids per track and taking each element out of the
 * array 2.4 more — 3.6 per track read, linear whatever the grid's size — while reading a field of a
 * track already in hand costs nothing. A fresh plugin has about 15,900 ids left (Figma's own API
 * holds the rest), so about 4,400 track reads fit in one plugin session. A track object is a
 * snapshot, not a view of the node, and editing a track fires no nodechange, so a read cannot be
 * served from an earlier one.
 *
 * Past that the counter overflows: a track read throws "Attempted to invoke callback with invalid
 * id", and so does any Figma API the session had not used yet. Every further track read spends
 * more, and once the counter wraps round a track's accessor calls whichever API function now holds
 * its id (get_removed, group and setFillStyleIdAsync were among those hit) and the runtime
 * eventually dies. Only reopening the plugin resets it.
 *
 * Tracks are read exactly as before until the runtime says it has run out; from then on no track is
 * ever made again in this session — a grid reports its sizes unavailable instead — so the first
 * overflow is the last. Nothing that read before stops reading earlier.
 */
let runtimeSpent = false;

// The overflowed counter is the only source measured, and its ids are negative (int16 past
// 32,767); any other wording is left to propagate as it always did.
const CALLBACK_IDS_SPENT = /Attempted to invoke callback with invalid id -\d/;

/** Whether an error is the runtime reporting its callback ids spent. */
export const isCallbackIdsSpent = (message: string): boolean => CALLBACK_IDS_SPENT.test(message);

/** What a read gives back when the tracks were left unread. */
export const TRACKS_UNREAD = Symbol('tracks unread');

/**
 * Run `read`, which makes track objects, unless the runtime has already run out of callback ids.
 * The runtime's own error marks the session spent and reads as unread; any other error is thrown,
 * as it always was.
 */
export const readTracks = <T>(read: () => T): T | typeof TRACKS_UNREAD => {
  if (runtimeSpent) return TRACKS_UNREAD;
  try {
    return read();
  } catch (error) {
    if (!isCallbackIdsSpent(error instanceof Error ? error.message : String(error))) throw error;
    runtimeSpent = true;
    return TRACKS_UNREAD;
  }
};

/** GridTrackSize[] → `{ type, value }[]` (FLEX = fr fraction, FIXED = px), as it always read. */
const serializeTracks = (tracks: unknown): SerializedGridTrack[] | undefined => {
  if (!Array.isArray(tracks)) return undefined;
  return tracks
    .filter(
      (t): t is { type: unknown; value: unknown } =>
        typeof t === 'object' && t !== null && 'type' in t && 'value' in t,
    )
    .map(t => ({ type: String(t.type), value: Number(t.value) }));
};

/** What reading one grid's tracks gave: both size lists, or that they were left unread. */
export type GridTrackRead =
  | { rows: SerializedGridTrack[] | undefined; columns: SerializedGridTrack[] | undefined }
  | { unavailable: true };

/** A grid's row and column sizes for a read — both, or neither. */
export const readGridTrackSizes = (grid: {
  gridRowSizes?: unknown;
  gridColumnSizes?: unknown;
}): GridTrackRead => {
  const read = readTracks(() => ({
    rows: serializeTracks(grid.gridRowSizes),
    columns: serializeTracks(grid.gridColumnSizes),
  }));
  return read === TRACKS_UNREAD ? { unavailable: true } : read;
};

/** Test seam: start a fresh plugin session. */
export const resetGridTrackReadsForTests = (): void => {
  runtimeSpent = false;
};
