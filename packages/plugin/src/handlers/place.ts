/**
 * Append a freshly-created node to the given parent (or the current page when parentId is omitted).
 * On an invalid parent the orphan node is removed so a failed create never litters the document.
 */
export const placeNode = async (
  figmaCtx: typeof figma,
  node: SceneNode,
  parentId: unknown,
  tool: string,
): Promise<void> => {
  if (typeof parentId !== 'string') {
    figmaCtx.currentPage.appendChild(node);
    return;
  }
  const parent = await figmaCtx.getNodeByIdAsync(parentId);
  if (parent === null || !('appendChild' in parent)) {
    node.remove();
    throw new Error(`${tool}: parent ${parentId} not found or cannot contain children`);
  }
  (parent as ChildrenMixin).appendChild(node);
};
