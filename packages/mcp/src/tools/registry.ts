// Single source of truth for what the MCP server advertises and which tools are writes. index.ts
// registers every spec with McpServer (which generates the advertised JSON Schema from each Zod
// inputShape); the write set is derived from `kind`, not maintained by hand. A registry test asserts
// these stay in sync with the plugin's handler map so a new tool can't be half-wired.

import { addPageTool } from './add-page.js';
import { addVariableModeTool } from './add-variable-mode.js';
import { analyzeProjectTool } from './analyze-project.js';
import { applyStyleToNodeTool } from './apply-style-to-node.js';
import { batchRenameNodesTool } from './batch-rename-nodes.js';
import { batchTool } from './batch.js';
import { bindVariableToNodeTool } from './bind-variable-to-node.js';
import { bindVariableToPaintTool } from './bind-variable-to-paint.js';
import { cloneNodeTool } from './clone-node.js';
import { combineAsVariantsTool } from './combine-as-variants.js';
import { componentMapTool } from './component-map.js';
import { createComponentTool } from './create-component.js';
import { createEffectStyleTool } from './create-effect-style.js';
import { createEllipseTool } from './create-ellipse.js';
import { createFrameTool } from './create-frame.js';
import { createGridStyleTool } from './create-grid-style.js';
import { createInstanceTool } from './create-instance.js';
import { createPaintStyleTool } from './create-paint-style.js';
import { createRectangleTool } from './create-rectangle.js';
import { createSectionTool } from './create-section.js';
import { createTextStyleTool } from './create-text-style.js';
import { createTextTool } from './create-text.js';
import { createVariableCollectionTool } from './create-variable-collection.js';
import { createVariableTool } from './create-variable.js';
import { deleteNodesTool } from './delete-nodes.js';
import { deletePageTool } from './delete-page.js';
import { deleteStyleTool } from './delete-style.js';
import { deleteVariableTool } from './delete-variable.js';
import { detachInstanceTool } from './detach-instance.js';
import { findReplaceTextTool } from './find-replace-text.js';
import { getAnnotationsTool } from './get-annotations.js';
import { getDesignContextTool } from './get-design-context.js';
import { getDocumentTool } from './get-document.js';
import { getFontsTool } from './get-fonts.js';
import { getLocalComponentsTool } from './get-local-components.js';
import { getMetadataTool } from './get-metadata.js';
import { getNodeTool } from './get-node.js';
import { getNodesInfoTool } from './get-nodes-info.js';
import { getPagesTool } from './get-pages.js';
import { getReactionsTool } from './get-reactions.js';
import { getScreenshotTool } from './get-screenshot.js';
import { getSelectionTool } from './get-selection.js';
import { getStylesTool } from './get-styles.js';
import { getVariableDefsTool } from './get-variable-defs.js';
import { getViewportTool } from './get-viewport.js';
import { groupNodesTool } from './group-nodes.js';
import { iconMapTool } from './icon-map.js';
import { importImageTool } from './import-image.js';
import { listFilesTool } from './list-files.js';
import { lockNodesTool } from './lock-nodes.js';
import { moveNodesTool } from './move-nodes.js';
import { navigateToPageTool } from './navigate-to-page.js';
import { pingTool } from './ping.js';
import { removeReactionsTool } from './remove-reactions.js';
import { renameNodeTool } from './rename-node.js';
import { renamePageTool } from './rename-page.js';
import { renameVariableTool } from './rename-variable.js';
import { reorderNodesTool } from './reorder-nodes.js';
import { reparentNodesTool } from './reparent-nodes.js';
import { resizeNodesTool } from './resize-nodes.js';
import { rotateNodesTool } from './rotate-nodes.js';
import { saveScreenshotsTool } from './save-screenshots.js';
import { scanComponentsTool } from './scan-components.js';
import { scanNodesByTypesTool } from './scan-nodes-by-types.js';
import { scanTextNodesTool } from './scan-text-nodes.js';
import { searchNodesTool } from './search-nodes.js';
import { setAutoLayoutTool } from './set-auto-layout.js';
import { setBlendModeTool } from './set-blend-mode.js';
import { setConstraintsTool } from './set-constraints.js';
import { setCornerRadiusTool } from './set-corner-radius.js';
import { setEffectsTool } from './set-effects.js';
import { setFillsTool } from './set-fills.js';
import { setLayoutPropsTool } from './set-layout-props.js';
import { setMaskTool } from './set-mask.js';
import { setOpacityTool } from './set-opacity.js';
import { setReactionsTool } from './set-reactions.js';
import { setStrokesTool } from './set-strokes.js';
import { setTextPropertiesTool } from './set-text-properties.js';
import { setTextTool } from './set-text.js';
import { setVariableValueTool } from './set-variable-value.js';
import { setVisibleTool } from './set-visible.js';
import type { ToolSpec } from './spec.js';
import { swapComponentTool } from './swap-component.js';
import { tokenMapTool } from './token-map.js';
import { ungroupNodesTool } from './ungroup-nodes.js';
import { unlockNodesTool } from './unlock-nodes.js';
import { updatePaintStyleTool } from './update-paint-style.js';

/** Every tool the MCP server registers, in ListTools order. */
export const ALL_TOOL_SPECS: readonly ToolSpec[] = [
  // Reads
  pingTool,
  getSelectionTool,
  getDocumentTool,
  getNodeTool,
  getNodesInfoTool,
  getMetadataTool,
  getPagesTool,
  searchNodesTool,
  scanTextNodesTool,
  scanNodesByTypesTool,
  getStylesTool,
  getVariableDefsTool,
  getLocalComponentsTool,
  getViewportTool,
  getFontsTool,
  getAnnotationsTool,
  getReactionsTool,
  listFilesTool,
  getDesignContextTool,
  getScreenshotTool,
  saveScreenshotsTool,
  // Server-local (filesystem; no plugin handler — like save_screenshots). analyze_project is an
  // optional standalone probe; scan_components / component_map also run detection internally.
  analyzeProjectTool,
  scanComponentsTool,
  componentMapTool,
  tokenMapTool,
  iconMapTool,
  // Writes
  setFillsTool,
  setTextTool,
  setTextPropertiesTool,
  createFrameTool,
  setOpacityTool,
  setVisibleTool,
  renameNodeTool,
  deleteNodesTool,
  createTextTool,
  createRectangleTool,
  setCornerRadiusTool,
  setStrokesTool,
  moveNodesTool,
  resizeNodesTool,
  setAutoLayoutTool,
  setLayoutPropsTool,
  setBlendModeTool,
  setMaskTool,
  setConstraintsTool,
  rotateNodesTool,
  lockNodesTool,
  unlockNodesTool,
  cloneNodeTool,
  setEffectsTool,
  createPaintStyleTool,
  createTextStyleTool,
  createEffectStyleTool,
  createGridStyleTool,
  updatePaintStyleTool,
  applyStyleToNodeTool,
  deleteStyleTool,
  createVariableCollectionTool,
  addVariableModeTool,
  createVariableTool,
  setVariableValueTool,
  bindVariableToNodeTool,
  bindVariableToPaintTool,
  renameVariableTool,
  deleteVariableTool,
  groupNodesTool,
  ungroupNodesTool,
  reparentNodesTool,
  reorderNodesTool,
  findReplaceTextTool,
  batchRenameNodesTool,
  addPageTool,
  deletePageTool,
  renamePageTool,
  navigateToPageTool,
  setReactionsTool,
  removeReactionsTool,
  swapComponentTool,
  detachInstanceTool,
  importImageTool,
  createEllipseTool,
  createComponentTool,
  createSectionTool,
  createInstanceTool,
  combineAsVariantsTool,
  batchTool,
];

/**
 * Write tools get a server-generated requestId (stable across dispatch retries) so the plugin can
 * dedupe side-effects. Reads don't need it. Derived from each spec's kind — no hand-kept list.
 */
export const WRITE_TOOL_NAMES: ReadonlySet<string> = new Set(
  ALL_TOOL_SPECS.filter(spec => spec.kind === 'write').map(spec => spec.name),
);
