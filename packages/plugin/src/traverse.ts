import { TimeSlice } from './cooperative.js';

const isSceneNode = (node: BaseNode): node is SceneNode =>
  node.type !== 'DOCUMENT' && node.type !== 'PAGE';

/**
 * A node's children, or null for a leaf type. `children` is a native getter that builds a fresh
 * array on every access, so it is read once here rather than once to test and again to iterate.
 */
export const childrenOf = (node: SceneNode): readonly SceneNode[] | null => {
  if (!('children' in node)) return null;
  const children = (node as { children?: unknown }).children;
  return Array.isArray(children) ? (children as readonly SceneNode[]) : null;
};

/**
 * Depth-first pre-order walk over a forest of scene nodes (each node, then its descendants).
 *
 * @yields Each scene node in the forest
 */
export function* walk(nodes: readonly SceneNode[]): Generator<SceneNode> {
  for (const node of nodes) {
    yield node;
    const children = childrenOf(node);
    if (children !== null) yield* walk(children);
  }
}

/**
 * The nodes {@link walk} would yield that satisfy `match`, in the same order — but collected
 * cooperatively, handing the thread back to Figma between slices. A page-wide walk is all native
 * getter reads and measured ~8–12s for a 32k-instance page; done in one go it froze the editor and
 * every other call for that long.
 */
export const collectMatches = async (
  nodes: readonly SceneNode[],
  match: (node: SceneNode) => boolean,
): Promise<SceneNode[]> => {
  const out: SceneNode[] = [];
  const stack = nodes.toReversed();
  const slice = new TimeSlice();
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (match(node)) out.push(node);
    const children = childrenOf(node);
    if (children !== null) {
      for (let i = children.length - 1; i >= 0; i -= 1) stack.push(children[i]!);
    }
    // eslint-disable-next-line no-await-in-loop -- hand the thread back between slices
    if (stack.length > 0 && slice.due()) await slice.yield();
  }
  return out;
};

/**
 * A forest flattened into pre-order, with each node's parent position (-1 for a root) and whether
 * it has a children array (an empty one included) — enough to rebuild the tree after serializing
 * the nodes as a flat list. Collected cooperatively, like {@link collectMatches}.
 */
export interface FlatForest {
  nodes: SceneNode[];
  parents: number[];
  hasChildren: boolean[];
}

export const flattenForest = async (roots: readonly SceneNode[]): Promise<FlatForest> => {
  const forest: FlatForest = { nodes: [], parents: [], hasChildren: [] };
  const stack: Array<{ node: SceneNode; parent: number }> = roots
    .map(node => ({ node, parent: -1 }))
    .toReversed();
  const slice = new TimeSlice();
  while (stack.length > 0) {
    const { node, parent } = stack.pop()!;
    const index = forest.nodes.length;
    forest.nodes.push(node);
    forest.parents.push(parent);
    const children = childrenOf(node);
    forest.hasChildren.push(children !== null);
    if (children !== null) {
      for (let i = children.length - 1; i >= 0; i -= 1) {
        stack.push({ node: children[i]!, parent: index });
      }
    }
    // eslint-disable-next-line no-await-in-loop -- hand the thread back between slices
    if (stack.length > 0 && slice.due()) await slice.yield();
  }
  return forest;
};

/**
 * Resolve the `root` param of a traversal tool to the forest to walk.
 *
 * - Omitted → the current page's children
 * - A SceneNode id → that single node (its subtree is reached via {@link walk})
 * - A PAGE id → that page's children
 * - Missing node / DOCUMENT → empty (no throw; mirrors get_node's null-on-miss contract)
 */
export const resolveScope = async (
  figmaCtx: typeof figma,
  root: unknown,
): Promise<readonly SceneNode[]> => {
  if (root === undefined || root === null) return figmaCtx.currentPage.children;
  if (typeof root !== 'string') {
    throw new TypeError('root must be a string node id');
  }
  const node = await figmaCtx.getNodeByIdAsync(root);
  if (node === null) return [];
  if (isSceneNode(node)) return [node];
  if (node.type === 'PAGE') return (node as PageNode).children;
  return [];
};
