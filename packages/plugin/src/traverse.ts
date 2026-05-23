const isSceneNode = (node: BaseNode): node is SceneNode =>
  node.type !== 'DOCUMENT' && node.type !== 'PAGE';

const hasChildren = (node: SceneNode): node is SceneNode & { children: readonly SceneNode[] } =>
  'children' in node && Array.isArray((node as { children?: unknown }).children);

/**
 * Depth-first pre-order walk over a forest of scene nodes (each node, then its descendants).
 * @yields each scene node in the forest
 */
export function* walk(nodes: readonly SceneNode[]): Generator<SceneNode> {
  for (const node of nodes) {
    yield node;
    if (hasChildren(node)) yield* walk(node.children);
  }
}

/**
 * Resolve the `root` param of a traversal tool to the forest to walk.
 * - omitted → the current page's children
 * - a SceneNode id → that single node (its subtree is reached via {@link walk})
 * - a PAGE id → that page's children
 * - missing node / DOCUMENT → empty (no throw; mirrors get_node's null-on-miss contract)
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
