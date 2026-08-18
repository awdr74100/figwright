// Turns a tool result — the exact object the relay sends back to the MCP server, i.e. what the LLM
// receives — into a display-ready snapshot for the Activity tab. Captured at the boundary so the
// human can see precisely what figwright fed the model. Long strings (base64 images) and raw export
// bytes are elided and the whole thing is capped so a huge tree can't lock up the panel; the digest
// still reports the real size that crossed the wire.

/** A captured, display-ready view of a tool result as it was sent to the LLM. */
export interface ActivityPayload {
  /** Pretty-printed JSON with long binary-ish strings elided and the whole thing capped. */
  preview: string;
  /**
   * Size in bytes of the full result JSON (including elided strings) — what actually crossed to the
   * LLM.
   */
  bytes: number;
  /** True when `preview` was cut to stay within PREVIEW_CAP. */
  truncated: boolean;
}

/** Strings longer than this are almost certainly base64/binary, not human content — elide them. */
export const LONG_STRING_THRESHOLD = 1024;
/** Hard cap on the rendered preview so a huge payload can't lock up the panel. */
export const PREVIEW_CAP = 100_000;

const byteLength = (s: string): number =>
  typeof TextEncoder === 'undefined' ? s.length : new TextEncoder().encode(s).length;

/**
 * Replacer that keeps a payload cheap to stringify.
 *
 * Raw export bytes have to be intercepted _before_ JSON sees them: a Uint8Array has no toJSON, so
 * `JSON.stringify` expands it into one key per byte — a 4.4MB export becomes a 51MB string and
 * ~375ms of main-thread work, on the very thread that draws the panel. Binary is summarised by
 * length, and its real byteLength is accumulated so the digest still reports what crossed the wire
 * rather than the placeholder.
 */
const makeElider = (): { replacer: (key: string, value: unknown) => unknown; binary: number } => {
  const state = {
    binary: 0,
    replacer: (_key: string, value: unknown): unknown => {
      if (ArrayBuffer.isView(value)) {
        state.binary += value.byteLength;
        return `‹${value.byteLength.toLocaleString()} bytes elided›`;
      }
      if (typeof value === 'string' && value.length > LONG_STRING_THRESHOLD) {
        return `‹${value.length.toLocaleString()} chars elided›`;
      }
      return value;
    },
  };
  return state;
};

/** Snapshot a tool result for display: real byte size + an elided, capped, pretty-printed preview. */
export const summarizePayload = (result: unknown): ActivityPayload => {
  // Long strings stay counted (they really did cross the wire as text); binary is counted by its
  // own byteLength, which is what a msgpack `bin` actually costs.
  const sizer = makeElider();
  let bytes = 0;
  try {
    const sized = JSON.stringify(result, (key, value) =>
      typeof value === 'string' ? value : sizer.replacer(key, value),
    );
    bytes = byteLength(sized ?? String(result)) + sizer.binary;
  } catch {
    /* circular / non-serializable — leave bytes at 0, fall through to the preview's own guard */
  }

  const elider = makeElider();
  let json: string;
  try {
    json = JSON.stringify(result, elider.replacer, 2) ?? String(result);
  } catch {
    json = String(result);
  }

  const truncated = json.length > PREVIEW_CAP;
  const preview = truncated ? `${json.slice(0, PREVIEW_CAP)}\n… (truncated for display)` : json;
  return { preview, bytes, truncated };
};
