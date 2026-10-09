const isSceneNode = (node: BaseNode): node is SceneNode =>
  node.type !== 'DOCUMENT' && node.type !== 'PAGE';

const hasChildren = (node: SceneNode): node is SceneNode & { children: readonly SceneNode[] } =>
  'children' in node && Array.isArray((node as { children?: unknown }).children);

/**
 * Depth-first pre-order walk over a forest of scene nodes (each node, then its descendants).
 *
 * @yields Each scene node in the forest
 */
export function* walk(nodes: readonly SceneNode[]): Generator<SceneNode> {
  for (const node of nodes) {
    yield node;
    if (hasChildren(node)) yield* walk(node.children);
  }
}

/**
 * Preserve depth-first order while letting the host run during costly native reads.
 *
 * @yields Each scene node in the forest
 */
export async function* walkCooperatively(nodes: readonly SceneNode[]): AsyncGenerator<SceneNode> {
  const pending = [nodes[Symbol.iterator]()];
  let visited = 0;
  let sliceStarted = Date.now();
  while (pending.length > 0) {
    if (visited >= 512 || Date.now() - sliceStarted >= 16) {
      // eslint-disable-next-line no-await-in-loop -- yield to Figma, not just promise microtasks
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      visited = 0;
      sliceStarted = Date.now();
    }
    const next = pending[pending.length - 1]!.next();
    if (next.done) {
      pending.pop();
      continue;
    }
    const node = next.value;
    visited += 1;
    yield node;
    if ('children' in node) {
      const children = node.children;
      if (Array.isArray(children)) pending.push(children[Symbol.iterator]());
    }
  }
}

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
