import type { SerializedGridTrack } from '@figwright/shared';

/**
 * Figma desktop's plugin runtime spends an entry of a fixed-size table every time a plugin reads a
 * field of a GridTrackSize — the objects in `gridRowSizes` / `gridColumnSizes`, whose `type` and
 * `value` are accessors — and frees none of them until the plugin closes. Measured on a page with
 * 64 grid frames and 448 tracks: each page-wide get_document spent ~3,640 entries (~8 per track),
 * and the tenth one in a plugin session ran the table (32,767 entries) out. From then on every read
 * that touches a track throws "Attempted to invoke callback with invalid id", and keeps doing so
 * until the plugin is reopened — so a whole-page read stays broken. Plain grid fields (counts,
 * gaps, placement modes) do not spend entries, and neither did 100,000 other host calls
 * (getNodeByIdAsync / getMainComponentAsync) in the same session.
 *
 * Track sizes are therefore read against an allowance per plugin session, kept well under the table
 * so other reads in the session have room: each track's two fields are read once, and once the
 * allowance is spent a grid still reports its counts, gaps and modes, but marks its sizes
 * unavailable instead of taking every later read down with it.
 */
export const GRID_TRACK_ALLOWANCE = 3000;

let tracksRead = 0;

/** What reading one grid's tracks gave: both size lists, or why they were left out. */
export type GridTrackRead =
  | { rows: SerializedGridTrack[] | undefined; columns: SerializedGridTrack[] | undefined }
  | { unavailable: true };

const readTracks = (raw: unknown): SerializedGridTrack[] | undefined => {
  if (!Array.isArray(raw)) return undefined;
  const out: SerializedGridTrack[] = [];
  for (const track of raw as unknown[]) {
    if (typeof track !== 'object' || track === null) continue;
    // One read per field: every read costs Figma a table entry (see above).
    const { type, value } = track as { type?: unknown; value?: unknown };
    if (type === undefined || value === undefined) continue;
    out.push({ type: String(type), value: Number(value) });
  }
  return out;
};

/**
 * Read a grid's row and column sizes, or report them unavailable once this session's allowance is
 * spent. `rowCount` / `columnCount` are the grid's own counts, read by the caller: they size the
 * read up front, so a grid that would overrun the allowance is never touched at all.
 */
export const readGridTrackSizes = (
  grid: { gridRowSizes?: unknown; gridColumnSizes?: unknown },
  rowCount: number | undefined,
  columnCount: number | undefined,
): GridTrackRead => {
  const expected = (rowCount ?? 0) + (columnCount ?? 0);
  if (tracksRead + expected > GRID_TRACK_ALLOWANCE) return { unavailable: true };
  const rows = readTracks(grid.gridRowSizes);
  const columns = readTracks(grid.gridColumnSizes);
  tracksRead += (rows?.length ?? 0) + (columns?.length ?? 0);
  return { rows, columns };
};

/** Test seam: start a fresh plugin session's allowance. */
export const resetGridTrackAllowanceForTests = (): void => {
  tracksRead = 0;
};
