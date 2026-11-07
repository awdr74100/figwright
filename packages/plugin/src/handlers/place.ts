/**
 * Append a freshly-created node to the given parent (or the current page when parentId is omitted).
 * A failed create never litters the document: on a parent that is missing or holds no children, and
 * on one that refuses this child — a component set takes only components, an instance takes no new
 * layers (measured: `appendChild` throws "Cannot move node") — the new node is removed. Figma puts
 * a created node on the current page before it is placed, so a refused move used to leave it
 * there.
 */
export const placeNode = async (
  figmaCtx: typeof figma,
  node: SceneNode,
  parentId: unknown,
  tool: string,
): Promise<void> => {
  let parent: BaseNode | null = figmaCtx.currentPage;
  if (typeof parentId === 'string') {
    parent = await figmaCtx.getNodeByIdAsync(parentId);
    if (parent === null || !('appendChild' in parent)) {
      node.remove();
      throw new Error(`${tool}: parent ${parentId} not found or cannot contain children`);
    }
  }
  try {
    (parent as BaseNode & ChildrenMixin).appendChild(node);
  } catch (error) {
    node.remove();
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${tool}: ${reason} (the new layer was removed)`, { cause: error });
  }
};
