/**
 * Select and frame the nodes a tool call touched, so clicking a row in the Activity tab jumps the
 * canvas to what that call did.
 *
 * This is UI control, not a tool: it's driven by the panel rather than by the agent, so it lives
 * outside the handler registry and never produces a relay reply.
 */

/** Ids the panel can send before the document has caught up, so every lookup is best-effort. */
export interface RevealOutcome {
  /** How many of the requested nodes were found, still alive, and reachable on one page. */
  revealed: number;
  /** True when the reveal had to switch the active page to get there. */
  switchedPage: boolean;
}

/**
 * Cap on how far a reveal zooms in. `scrollAndZoomIntoView` fits the nodes to the viewport, which
 * for a small text node means zooming past 1000%: the node fills the screen, but with no
 * surroundings left to orient against. Backing off keeps neighbouring content in frame, which is
 * what actually makes it obvious _where_ the node sits.
 */
const MAX_REVEAL_ZOOM = 4;

/** The document and its pages can't be selected or zoomed to — only the scene graph below them. */
const isSceneNode = (node: BaseNode): node is SceneNode =>
  node.type !== 'DOCUMENT' && node.type !== 'PAGE';

/** Walk up to the page a node lives on; detached nodes have no page and can't be revealed. */
const pageOf = (node: BaseNode): PageNode | null => {
  let cursor: BaseNode | null = node;
  while (cursor !== null) {
    if (cursor.type === 'PAGE') return cursor;
    cursor = cursor.parent;
  }
  return null;
};

/**
 * Reveal as many of `nodeIds` as are still reachable.
 *
 * Ids can be stale — the agent may have deleted the node since, or the user may have undone the
 * call — so anything missing is skipped rather than treated as an error. When the nodes span
 * several pages, the first one's page wins and the rest are left behind: a selection can only exist
 * on one page, and following the first id matches what the row's leading node means to the user.
 */
export const revealNodes = async (
  figmaCtx: typeof figma,
  nodeIds: readonly string[],
): Promise<RevealOutcome> => {
  // `Promise.all` keeps results in request order, so the first id still decides the target page.
  // A lookup can reject when the document shifted underneath it; treat that as "not found".
  const resolved = await Promise.all(
    nodeIds.map(id => figmaCtx.getNodeByIdAsync(id).catch(() => null)),
  );
  const found = resolved.filter(
    (node): node is SceneNode => node !== null && !node.removed && isSceneNode(node),
  );
  if (found.length === 0) return { revealed: 0, switchedPage: false };

  const target = pageOf(found[0] as SceneNode);
  if (target === null) return { revealed: 0, switchedPage: false };

  const onTarget = found.filter(node => pageOf(node) === target);
  const switchedPage = target.id !== figmaCtx.currentPage.id;
  // Required under `documentAccess: "dynamic-page"` — assigning currentPage directly would throw.
  if (switchedPage) await figmaCtx.setCurrentPageAsync(target);

  figmaCtx.currentPage.selection = onTarget;
  figmaCtx.viewport.scrollAndZoomIntoView(onTarget);
  if (figmaCtx.viewport.zoom > MAX_REVEAL_ZOOM) figmaCtx.viewport.zoom = MAX_REVEAL_ZOOM;

  return { revealed: onTarget.length, switchedPage };
};
