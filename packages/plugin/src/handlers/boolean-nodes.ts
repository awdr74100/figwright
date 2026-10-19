import type { CreateResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

type Operation = 'UNION' | 'SUBTRACT' | 'INTERSECT' | 'EXCLUDE';
const OPERATIONS = new Set<string>(['UNION', 'SUBTRACT', 'INTERSECT', 'EXCLUDE']);

/**
 * Resolve ids to nodes that can be reparented under one shared parent, or throw saying why not. The
 * nodes come back bottom to top in the parent's stack, whatever order the ids were in.
 */
export const resolveSharedParent = async (
  figmaCtx: typeof figma,
  ids: readonly string[],
  tool: string,
): Promise<{ nodes: SceneNode[]; parent: BaseNode & ChildrenMixin; index: number }> => {
  const resolved = await Promise.all(ids.map(id => figmaCtx.getNodeByIdAsync(id)));
  const nodes = resolved.map((node, i) => {
    if (node === null) throw new Error(`${tool}: node ${ids[i]} not found`);
    if (!('parent' in node) || node.type === 'DOCUMENT' || node.type === 'PAGE') {
      throw new Error(`${tool}: node ${ids[i]} is a ${node.type}, not a layer`);
    }
    return node as SceneNode;
  });
  const parent = nodes[0]!.parent;
  if (parent === null || !('appendChild' in parent)) {
    throw new Error(`${tool}: nodes have no parent that can hold the result`);
  }
  const other = nodes.find(n => n.parent !== parent);
  if (other !== undefined) {
    throw new Error(
      `${tool}: nodes must share one parent — ${other.id} is under a different one. ` +
        'Move them together first with reparent_nodes.',
    );
  }
  const container = parent as BaseNode & ChildrenMixin;
  // Bottom to top, as the layers panel stacks them (read now: the operation re-parents them).
  const stacked = nodes.toSorted(
    (a, b) => container.children.indexOf(a) - container.children.indexOf(b),
  );
  // Land where the topmost operand was, so the result keeps its place in the stack.
  const index = container.children.indexOf(stacked.at(-1)!);
  return { nodes: stacked, parent: container, index };
};

const styleOf = (node: SceneNode, key: 'fillStyleId' | 'effectStyleId'): string | null => {
  const id = (node as Partial<Record<typeof key, unknown>>)[key];
  return typeof id === 'string' && id !== '' ? id : null;
};

/** Copy what Figma's Boolean command copies from `source`: its fills and its effects. */
const carryLook = async (source: SceneNode, result: BooleanOperationNode): Promise<void> => {
  const fillStyle = styleOf(source, 'fillStyleId');
  const fills = (source as Partial<MinimalFillsMixin>).fills;
  if (fillStyle !== null) await result.setFillStyleIdAsync(fillStyle);
  else if (Array.isArray(fills)) result.fills = fills;

  const effectStyle = styleOf(source, 'effectStyleId');
  const effects = (source as Partial<BlendMixin>).effects;
  if (effectStyle !== null) await result.setEffectStyleIdAsync(effectStyle);
  else if (Array.isArray(effects)) result.effects = effects;
};

export const createBooleanNodesHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { operation?: unknown; nodeIds?: unknown; name?: unknown };
    if (typeof p.operation !== 'string' || !OPERATIONS.has(p.operation)) {
      throw new TypeError('boolean_nodes: operation must be UNION, SUBTRACT, INTERSECT or EXCLUDE');
    }
    if (!Array.isArray(p.nodeIds) || p.nodeIds.some(id => typeof id !== 'string')) {
      throw new TypeError('boolean_nodes: nodeIds must be a string[]');
    }
    const ids = [...new Set(p.nodeIds as readonly string[])];
    if (ids.length < 2) {
      throw new TypeError('boolean_nodes: nodeIds must name at least 2 distinct nodes');
    }
    const { nodes, parent, index } = await resolveSharedParent(figmaCtx, ids, 'boolean_nodes');
    // Figma's own Boolean command paints the group with the fill and effects of the topmost
    // operand (the bottom one for SUBTRACT, the shape being cut) — measured in the editor, which
    // also showed the stroke is NOT carried. figma.union & co. leave the default grey instead, so
    // carry the same two properties here; a style is re-applied as the style, not as its values.
    const source = p.operation === 'SUBTRACT' ? nodes[0]! : nodes.at(-1)!;

    const run: Record<Operation, typeof figma.union> = {
      UNION: figmaCtx.union.bind(figmaCtx),
      SUBTRACT: figmaCtx.subtract.bind(figmaCtx),
      INTERSECT: figmaCtx.intersect.bind(figmaCtx),
      EXCLUDE: figmaCtx.exclude.bind(figmaCtx),
    };
    const result = run[p.operation as Operation](nodes, parent, index);
    await carryLook(source, result);
    if (typeof p.name === 'string') result.name = p.name;

    const out: CreateResult = { ok: true, nodeId: result.id, name: result.name, type: result.type };
    return out;
  };
