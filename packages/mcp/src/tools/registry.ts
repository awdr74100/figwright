// Single source of truth for what the MCP server advertises and which tools are writes. index.ts
// registers every spec with McpServer (which generates the advertised JSON Schema from each Zod
// inputSchema); the write set is derived from `kind`, not maintained by hand. A registry test asserts
// these stay in sync with the plugin's handler map so a new tool can't be half-wired.

import { z } from 'zod';

import { addComponentPropertyTool } from './add-component-property.js';
import { addPageTool } from './add-page.js';
import { addVariableModeTool } from './add-variable-mode.js';
import { analyzeProjectTool } from './analyze-project.js';
import { applyAnimationStyleTool } from './apply-animation-style.js';
import { applyManualKeyframeTrackTool } from './apply-manual-keyframe-track.js';
import { applyStyleToNodeTool } from './apply-style-to-node.js';
import { batchRenameNodesTool } from './batch-rename-nodes.js';
import { batchTool } from './batch.js';
import { bindComponentPropertyTool } from './bind-component-property.js';
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
import { deleteComponentPropertyTool } from './delete-component-property.js';
import { deleteNodesTool } from './delete-nodes.js';
import { deletePageTool } from './delete-page.js';
import { deleteStyleTool } from './delete-style.js';
import { deleteVariableCollectionTool } from './delete-variable-collection.js';
import { deleteVariableTool } from './delete-variable.js';
import { designDiffTool } from './design-diff.js';
import { detachInstanceTool } from './detach-instance.js';
import { editComponentPropertyTool } from './edit-component-property.js';
import { exportPdfTool } from './export-pdf.js';
import { exportVideoTool } from './export-video.js';
import { findReplaceTextTool } from './find-replace-text.js';
import { getAnnotationsTool } from './get-annotations.js';
import { getComponentApiTool } from './get-component-api.js';
import { getDesignContextTool } from './get-design-context.js';
import { getDocumentTool } from './get-document.js';
import { getFontsTool } from './get-fonts.js';
import { getLocalComponentsTool } from './get-local-components.js';
import { getMetadataTool } from './get-metadata.js';
import { getMotionStylesTool } from './get-motion-styles.js';
import { getNodeMotionTool } from './get-node-motion.js';
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
import { importSvgTool } from './import-svg.js';
import { listFilesTool } from './list-files.js';
import { lockNodesTool } from './lock-nodes.js';
import { moveNodesTool } from './move-nodes.js';
import { navigateToPageTool } from './navigate-to-page.js';
import { pingTool } from './ping.js';
import { removeAnimationStyleTool } from './remove-animation-style.js';
import { removeManualKeyframeTrackTool } from './remove-manual-keyframe-track.js';
import { removeReactionsTool } from './remove-reactions.js';
import { renameNodeTool } from './rename-node.js';
import { renamePageTool } from './rename-page.js';
import { renameVariableTool } from './rename-variable.js';
import { reorderNodesTool } from './reorder-nodes.js';
import { reparentNodesTool } from './reparent-nodes.js';
import { resizeNodesTool } from './resize-nodes.js';
import { rotateNodesTool } from './rotate-nodes.js';
import { saveImageFillsTool } from './save-image-fills.js';
import { saveScreenshotsTool } from './save-screenshots.js';
import { scanComponentsTool } from './scan-components.js';
import { scanNodesByTypesTool } from './scan-nodes-by-types.js';
import { scanTextNodesTool } from './scan-text-nodes.js';
import { searchNodesTool } from './search-nodes.js';
import { setArcTool } from './set-arc.js';
import { setAutoLayoutTool } from './set-auto-layout.js';
import { setBlendModeTool } from './set-blend-mode.js';
import { setConstraintsTool } from './set-constraints.js';
import { setCornerRadiusTool } from './set-corner-radius.js';
import { setEffectsTool } from './set-effects.js';
import { setFillsTool } from './set-fills.js';
import { setInstancePropertiesTool } from './set-instance-properties.js';
import { setLayoutGridsTool } from './set-layout-grids.js';
import { setLayoutPropsTool } from './set-layout-props.js';
import { setMaskTool } from './set-mask.js';
import { setOpacityTool } from './set-opacity.js';
import { setPositionTool } from './set-position.js';
import { setReactionsTool } from './set-reactions.js';
import { setStrokesTool } from './set-strokes.js';
import { setTextPropertiesTool } from './set-text-properties.js';
import { setTextRangeTool } from './set-text-range.js';
import { setTextTool } from './set-text.js';
import { setTimelineDurationTool } from './set-timeline-duration.js';
import { setVariableCodeSyntaxTool } from './set-variable-code-syntax.js';
import { setVariableValueTool } from './set-variable-value.js';
import { setVisibleTool } from './set-visible.js';
import type { ToolSpec } from './spec.js';
import { swapComponentTool } from './swap-component.js';
import { tokenMapTool } from './token-map.js';
import { ungroupNodesTool } from './ungroup-nodes.js';
import { unlockNodesTool } from './unlock-nodes.js';
import { updateEffectStyleTool } from './update-effect-style.js';
import { updatePaintStyleTool } from './update-paint-style.js';
import { updateTextStyleTool } from './update-text-style.js';
import { useFileTool } from './use-file.js';

/**
 * Every tool the MCP server registers, in ListTools order.
 *
 * Declared here, then handed through {@linkcode strictArgs} so no tool can accept an argument it
 * does not declare.
 */
const DECLARED_TOOL_SPECS: readonly ToolSpec[] = [
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
  getComponentApiTool,
  getViewportTool,
  getFontsTool,
  getAnnotationsTool,
  getReactionsTool,
  getMotionStylesTool,
  getNodeMotionTool,
  listFilesTool,
  useFileTool,
  getDesignContextTool,
  getScreenshotTool,
  saveScreenshotsTool,
  saveImageFillsTool,
  exportPdfTool,
  exportVideoTool,
  // Server-local (filesystem; no plugin handler — like save_screenshots). analyze_project is an
  // optional standalone probe; scan_components / component_map also run detection internally.
  analyzeProjectTool,
  scanComponentsTool,
  componentMapTool,
  tokenMapTool,
  iconMapTool,
  designDiffTool,
  // Writes
  setFillsTool,
  setTextTool,
  setTextPropertiesTool,
  setTextRangeTool,
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
  setPositionTool,
  resizeNodesTool,
  setAutoLayoutTool,
  setLayoutPropsTool,
  setLayoutGridsTool,
  setBlendModeTool,
  setMaskTool,
  setArcTool,
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
  updateTextStyleTool,
  updateEffectStyleTool,
  applyStyleToNodeTool,
  deleteStyleTool,
  createVariableCollectionTool,
  addVariableModeTool,
  createVariableTool,
  setVariableValueTool,
  bindVariableToNodeTool,
  bindVariableToPaintTool,
  renameVariableTool,
  setVariableCodeSyntaxTool,
  deleteVariableTool,
  deleteVariableCollectionTool,
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
  setInstancePropertiesTool,
  addComponentPropertyTool,
  bindComponentPropertyTool,
  editComponentPropertyTool,
  deleteComponentPropertyTool,
  detachInstanceTool,
  importImageTool,
  importSvgTool,
  createEllipseTool,
  createComponentTool,
  createSectionTool,
  createInstanceTool,
  combineAsVariantsTool,
  // Motion (beta) — Figma Design only
  applyAnimationStyleTool,
  removeAnimationStyleTool,
  applyManualKeyframeTrackTool,
  removeManualKeyframeTrackTool,
  setTimelineDurationTool,
  batchTool,
];

/**
 * Close a tool's argument object, so an argument it never declared is refused instead of dropped.
 *
 * Zod strips unknown keys by default and JSON Schema allows them by default, so both halves of the
 * contract used to say yes to an argument that does nothing. Measured on the wire:
 * `create_variable` with an extra `value` — a field it has never had, since a new variable starts
 * empty and takes its values from `set_variable_value` — passed validation and ran, and the call
 * reported `ok: true` over eight variables that were all still white. Nothing between the model and
 * the canvas could see it; only a screenshot could.
 *
 * That is the shape this exists for. An argument an agent believes in is a belief about what the
 * call did, and a write that silently drops one reports success for something else — the same
 * defect as a stale plugin ignoring a field it predates, which this repo already refuses to let
 * pass quietly (see `pluginSkewNotice`). Rejection is also only half the fix:
 * `additionalProperties: false` now reaches the model in the advertised schema, so the better
 * outcome is the call that is never made.
 *
 * Applied here rather than per tool because all three consumers of a spec read from this one list —
 * the SDK registration, `test/e2e/mcp-wire.test.ts`'s independent derivation, and `wireToolSchema`
 * — so one edit keeps them agreeing. It reaches only the agent-facing surface: `wireToolSchema`
 * rebuilds from `.shape`, leaving the plugin-facing schema exactly as it was. That surface carries
 * server-injected fields it has to declare completely, and closing it has a fail-closed failure
 * mode of its own that wants its own evidence.
 */
const strictArgs = (spec: ToolSpec): ToolSpec => ({
  ...spec,
  inputSchema: z.strictObject(spec.inputSchema.shape),
});

export const ALL_TOOL_SPECS: readonly ToolSpec[] = DECLARED_TOOL_SPECS.map(strictArgs);

/**
 * Write tools get a server-generated requestId (stable across dispatch retries) so the plugin can
 * dedupe side-effects. Reads don't need it. Derived from each spec's kind — no hand-kept list.
 */
export const WRITE_TOOL_NAMES: ReadonlySet<string> = new Set(
  ALL_TOOL_SPECS.filter(spec => spec.kind === 'write').map(spec => spec.name),
);
