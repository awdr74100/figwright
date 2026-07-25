// Pulls the Figma node ids a tool call touched out of its raw params and result, so the Activity tab
// can offer to jump to them on canvas. Runs at the relay boundary where both are still objects —
// the display payloads next to it are pretty-printed strings, and are capped, so they can't be
// parsed back reliably.

/**
 * Figma ids look like `1:23`, or `I422:1234;422:1200` for a node inside an instance. Matching
 * loosely (rather than trusting any string under the key) keeps sentinel values out.
 */
const NODE_ID = /^[A-Za-z]?\d+:\d+(?:;[A-Za-z]?\d+:\d+)*$/;

/** Keys that name the node(s) a call acts on, or — in a result — the node it just created. */
const ID_KEYS = new Set(['nodeId', 'nodeIds']);

/** Batch operations nest their params, so the walk has to recurse — but not without a floor. */
const MAX_DEPTH = 6;
/** A batch can carry hundreds of ops; revealing more than a handful is meaningless anyway. */
const MAX_IDS = 50;

const collect = (value: unknown, depth: number, out: Set<string>): void => {
  if (depth > MAX_DEPTH || out.size >= MAX_IDS || value === null || typeof value !== 'object') {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) collect(item, depth + 1, out);
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (ID_KEYS.has(key)) {
      if (typeof child === 'string' && NODE_ID.test(child)) out.add(child);
      else if (Array.isArray(child)) {
        for (const id of child) {
          if (typeof id === 'string' && NODE_ID.test(id)) out.add(id);
          if (out.size >= MAX_IDS) break;
        }
      }
    }
    collect(child, depth + 1, out);
  }
};

/**
 * Node ids referenced by a call, in first-seen order. Params come first so a call that both targets
 * and creates a node (`clone_node`) leads with what the user asked about.
 */
export const extractNodeIds = (...sources: unknown[]): string[] => {
  const out = new Set<string>();
  for (const source of sources) collect(source, 0, out);
  return [...out];
};
