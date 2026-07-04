import type { GetDesignContextResult, DesignContextNode } from '@figwright/shared';

// The design-diff core: compare two get_design_context snapshots of the same node and report what
// changed, per node, per property. Pure over its inputs (no filesystem, no plugin) so it's fully
// unit-testable; design-diff the tool wraps it with the snapshot store + the get_design_context call.
//
// Two normalizations make the output actionable rather than opaque:
//   1. globalVars refs (fill / stroke / effect / textStyle point into result.globalVars.styles by a
//      content-hash id) are inlined to their actual value, so a changed fill reads as a paint delta,
//      not "fill_AB12 → fill_9F3K".
//   2. token ids (styleIds slots + boundVariables bindings point into result.styles / result.variables)
//      are resolved to their human names, so a rebind reads as "Primary/500 → Primary/600".
// Both are applied symmetrically to baseline and current, so the diff compares like with like. The
// stored snapshot keeps the RAW result (faithful, re-diffable if this logic improves) — resolution
// lives here, at compare time.

export interface FieldChange {
  /** The node field that changed (a DesignContextNode key, or synthetic `parent` / `order`). */
  field: string;
  before: unknown;
  after: unknown;
}

export type NodeChangeKind = 'added' | 'removed' | 'changed';

export interface NodeChange {
  id: string;
  name: string;
  type: string;
  /** Readable location: the chain of ancestor names, e.g. "PriceCard / Header / Title". */
  path: string;
  kind: NodeChangeKind;
  /** Present only for `changed`: the per-field deltas (resolved values). */
  fields?: FieldChange[];
}

export interface DesignDiffChanges {
  added: NodeChange[];
  removed: NodeChange[];
  changed: NodeChange[];
}

/** A node flattened for comparison: own fields (resolved, children stripped) + structural context. */
interface FlatNode {
  own: Record<string, unknown>;
  name: string;
  type: string;
  path: string;
  parentId: string | null;
  index: number;
}

/** Structural walk keys that must never be treated as a comparable value field. */
const STRUCTURAL_KEYS = new Set(['children']);

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Deep structural equality over the JSON-ish values get_design_context emits
 * (primitives/arrays/objects).
 */
export const deepEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ak = Object.keys(a);
    const bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    return ak.every(k => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
  }
  return false;
};

/**
 * Resolve one node's own fields into diff-ready values: inline globalVars style refs and map token
 * ids to names, using the result-level tables. Non-own-value keys (children) are dropped; every
 * other key is copied through so a schema field added later is diffed automatically (no allowlist
 * to go stale — matching the repo's "don't drop a dimension" bar).
 */
const resolveOwnFields = (
  node: DesignContextNode,
  globalVars: Readonly<Record<string, unknown>>,
  tokenName: (id: string) => string,
): Record<string, unknown> => {
  const own: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (STRUCTURAL_KEYS.has(key)) continue;
    if (
      (key === 'fill' || key === 'stroke' || key === 'effect' || key === 'textStyle') &&
      typeof value === 'string'
    ) {
      // A globalVars ref → its actual bundle, so the delta is the paint/typography, not the hash.
      own[key] = Object.hasOwn(globalVars, value) ? globalVars[value] : value;
      continue;
    }
    if (key === 'styleIds' && isPlainObject(value)) {
      // { fill: "S:1", text: "S:2" } → { fill: "Primary/500", text: "Body/Bold" }
      const out: Record<string, unknown> = {};
      for (const [slot, id] of Object.entries(value)) {
        out[slot] = typeof id === 'string' ? tokenName(id) : id;
      }
      own[key] = out;
      continue;
    }
    if (key === 'boundVariables' && isPlainObject(value)) {
      // { fills: ["V:1"], … } → { fills: ["Primary/500"], … }
      const out: Record<string, unknown> = {};
      for (const [prop, ids] of Object.entries(value)) {
        out[prop] = Array.isArray(ids)
          ? ids.map(id => (typeof id === 'string' ? tokenName(id) : id))
          : ids;
      }
      own[key] = out;
      continue;
    }
    own[key] = value;
  }
  return own;
};

/**
 * Flatten a snapshot into id → FlatNode, resolving refs/tokens and recording each node's path,
 * parent, and sibling index. Duplicate ids (shouldn't happen in one Figma tree) keep the first
 * seen.
 */
const flattenResolved = (ctx: GetDesignContextResult): Map<string, FlatNode> => {
  const globalVars = ctx.globalVars?.styles ?? {};
  const tokenName = (id: string): string =>
    ctx.variables?.[id]?.name ?? ctx.styles?.[id]?.name ?? id;

  const out = new Map<string, FlatNode>();
  const visit = (
    node: DesignContextNode,
    parentId: string | null,
    index: number,
    ancestry: readonly string[],
  ): void => {
    const path = [...ancestry, node.name].join(' / ');
    if (!out.has(node.id)) {
      out.set(node.id, {
        own: resolveOwnFields(node, globalVars, tokenName),
        name: node.name,
        type: node.type,
        path,
        parentId,
        index,
      });
    }
    const kids = node.children ?? [];
    for (let i = 0; i < kids.length; i += 1)
      visit(kids[i] as DesignContextNode, node.id, i, [...ancestry, node.name]);
  };
  for (let i = 0; i < ctx.nodes.length; i += 1)
    visit(ctx.nodes[i] as DesignContextNode, null, i, []);
  return out;
};

/** The per-field deltas between two flattened nodes: own-field changes plus structural moves. */
const fieldChanges = (before: FlatNode, after: FlatNode): FieldChange[] => {
  const changes: FieldChange[] = [];
  const keys = new Set([...Object.keys(before.own), ...Object.keys(after.own)]);
  for (const key of [...keys].toSorted()) {
    const b = before.own[key];
    const a = after.own[key];
    if (!deepEqual(b, a)) changes.push({ field: key, before: b, after: a });
  }
  // Structure: a reparent (parent changed) subsumes any index shift; a pure reorder (same parent,
  // new index) is reported on its own. Both are real design edits worth surfacing.
  if (before.parentId !== after.parentId) {
    changes.push({ field: 'parent', before: before.parentId, after: after.parentId });
  } else if (before.index !== after.index) {
    changes.push({ field: 'order', before: before.index, after: after.index });
  }
  return changes;
};

const asChange = (
  flat: FlatNode,
  id: string,
  kind: NodeChangeKind,
  fields?: FieldChange[],
): NodeChange => ({
  id,
  name: flat.name,
  type: flat.type,
  path: flat.path,
  kind,
  ...(fields === undefined ? {} : { fields }),
});

/**
 * Diff two get_design_context snapshots of the same root. Nodes are matched by Figma id (stable
 * across property edits within a file); a node only in the baseline is `removed`, only in the
 * current is `added`, in both with any field/structure delta is `changed`. Pure.
 */
export const diffDesignContext = (
  baseline: GetDesignContextResult,
  current: GetDesignContextResult,
): DesignDiffChanges => {
  const before = flattenResolved(baseline);
  const after = flattenResolved(current);

  const removed: NodeChange[] = [];
  const changed: NodeChange[] = [];
  for (const [id, flat] of before) {
    const now = after.get(id);
    if (now === undefined) {
      removed.push(asChange(flat, id, 'removed'));
      continue;
    }
    const fields = fieldChanges(flat, now);
    if (fields.length > 0) changed.push(asChange(now, id, 'changed', fields));
  }

  const added: NodeChange[] = [];
  for (const [id, flat] of after) {
    if (!before.has(id)) added.push(asChange(flat, id, 'added'));
  }

  return { added, removed, changed };
};
