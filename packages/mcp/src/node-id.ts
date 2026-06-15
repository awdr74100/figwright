// Normalize node-id arguments so a user can paste a Figma URL or the URL's dash-form node id
// straight into any tool. Figma deep links carry the node id as `?node-id=17248-32218` (dashes),
// while the Plugin API — and therefore every figwright tool — wants the canonical colon form
// `17248:32218`. We resolve this once, server-side, before the call reaches the plugin, so callers
// never have to hand-convert (the official Figma skills document this conversion as a manual step;
// we just do it).
//
// Scope: this only rewrites the id *string*. We are a plugin-based server operating on the connected
// file, so the URL's fileKey is irrelevant here — we never fetch an arbitrary file by key.

const FIGMA_URL = /figma\.com\//i;
const NODE_ID_QUERY = /[?&]node-id=([^&]+)/i;
// A canonical/dash node id is digits, ':' or '-' pair separators, ';' segment separators, and an
// optional 'I' instance prefix (e.g. `1:42`, `I17248:32218;19656:154511`). Restricting to this
// shape means a non-id string (a layer name, a search term) is never mangled.
const NODE_ID_SHAPE = /^[\dI:;-]+$/;

/**
 * Turn a Figma URL or dash-form node id into the canonical colon form. Anything that isn't a Figma
 * URL or a node-id-shaped string is returned unchanged.
 */
export const normalizeNodeId = (raw: string): string => {
  let value = raw.trim();

  if (FIGMA_URL.test(value)) {
    const match = NODE_ID_QUERY.exec(value);
    const captured = match?.[1];
    if (captured === undefined) return raw; // a Figma URL with no node-id — nothing to resolve
    try {
      value = decodeURIComponent(captured);
    } catch {
      value = captured; // malformed escape — fall back to the raw capture
    }
  }

  // Dash → colon only for id-shaped strings that actually contain a dash. The URL form replaces the
  // canonical ':' with '-' (and leaves ';' / 'I' intact), so a blanket '-'→':' reverses it exactly.
  if (value.includes('-') && NODE_ID_SHAPE.test(value)) {
    value = value.replace(/-/g, ':');
  }

  return value;
};

const STRING_ID_FIELDS = ['nodeId', 'parentId'] as const;

/**
 * Normalize the id-bearing fields of a tool's argument object in place of the caller having to do
 * it: `nodeId` / `parentId` (strings) and `nodeIds` (string array). Non-object args pass through.
 */
export const normalizeIdArgs = (args: unknown): unknown => {
  if (typeof args !== 'object' || args === null) return args;
  const record = args as Record<string, unknown>;
  let out: Record<string, unknown> | null = null;
  const ensure = (): Record<string, unknown> => (out ??= { ...record });

  for (const field of STRING_ID_FIELDS) {
    const v = record[field];
    if (typeof v === 'string') {
      const normalized = normalizeNodeId(v);
      if (normalized !== v) ensure()[field] = normalized;
    }
  }

  if (Array.isArray(record.nodeIds)) {
    const ids = record.nodeIds;
    let changed = false;
    const mapped = ids.map(id => {
      if (typeof id !== 'string') return id;
      const normalized = normalizeNodeId(id);
      if (normalized !== id) changed = true;
      return normalized;
    });
    if (changed) ensure().nodeIds = mapped;
  }

  return out ?? args;
};
