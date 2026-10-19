import type { CreateResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

type Operation = 'UNION' | 'SUBTRACT' | 'INTERSECT' | 'EXCLUDE';
const OPERATIONS = new Set<string>(['UNION', 'SUBTRACT', 'INTERSECT', 'EXCLUDE']);

/** Resolve ids to nodes that can be reparented under one shared parent, or throw saying why not. */
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
  // Land where the topmost operand was, so the result keeps its place in the stack.
  const index = Math.max(...nodes.map(n => container.children.indexOf(n)));
  return { nodes, parent: container, index };
};

export const createBooleanOperationHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { operation?: unknown; nodeIds?: unknown; name?: unknown };
    if (typeof p.operation !== 'string' || !OPERATIONS.has(p.operation)) {
      throw new TypeError(
        'boolean_operation: operation must be UNION, SUBTRACT, INTERSECT or EXCLUDE',
      );
    }
    if (
      !Array.isArray(p.nodeIds) ||
      p.nodeIds.length < 2 ||
      p.nodeIds.some(id => typeof id !== 'string')
    ) {
      throw new TypeError('boolean_operation: nodeIds must be a string[] of at least 2');
    }
    const { nodes, parent, index } = await resolveSharedParent(
      figmaCtx,
      p.nodeIds as readonly string[],
      'boolean_operation',
    );

    const run: Record<Operation, typeof figma.union> = {
      UNION: figmaCtx.union.bind(figmaCtx),
      SUBTRACT: figmaCtx.subtract.bind(figmaCtx),
      INTERSECT: figmaCtx.intersect.bind(figmaCtx),
      EXCLUDE: figmaCtx.exclude.bind(figmaCtx),
    };
    const result = run[p.operation as Operation](nodes, parent, index);
    if (typeof p.name === 'string') result.name = p.name;

    const out: CreateResult = { ok: true, nodeId: result.id, name: result.name, type: result.type };
    return out;
  };
