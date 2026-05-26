import type { Tool } from '@modelcontextprotocol/sdk/types.js';

// Single source of truth for what the MCP server advertises and which tools are writes. index.ts
// consumes these; a registry test asserts they stay in sync with the plugin's handler map (so a new
// tool can't be half-wired) and that every input schema property declares a type.

import { analyzeProjectToolDefinition } from './analyze-project.js';
import { scanComponentsToolDefinition } from './scan-components.js';
import { getAnnotationsToolDefinition } from './get-annotations.js';
import { getDesignContextToolDefinition } from './get-design-context.js';
import { getDocumentToolDefinition } from './get-document.js';
import { getFontsToolDefinition } from './get-fonts.js';
import { getLocalComponentsToolDefinition } from './get-local-components.js';
import { getMetadataToolDefinition } from './get-metadata.js';
import { getNodeToolDefinition } from './get-node.js';
import { getNodesInfoToolDefinition } from './get-nodes-info.js';
import { getPagesToolDefinition } from './get-pages.js';
import { getReactionsToolDefinition } from './get-reactions.js';
import { getScreenshotToolDefinition } from './get-screenshot.js';
import { getSelectionToolDefinition } from './get-selection.js';
import { getStylesToolDefinition } from './get-styles.js';
import { getVariableDefsToolDefinition } from './get-variable-defs.js';
import { getViewportToolDefinition } from './get-viewport.js';
import { listFilesToolDefinition } from './list-files.js';
import { pingToolDefinition } from './ping.js';
import { saveScreenshotsToolDefinition } from './save-screenshots.js';
import { scanNodesByTypesToolDefinition } from './scan-nodes-by-types.js';
import { scanTextNodesToolDefinition } from './scan-text-nodes.js';
import { searchNodesToolDefinition } from './search-nodes.js';
import { CLONE_NODE_TOOL_NAME, cloneNodeToolDefinition } from './clone-node.js';
import { CREATE_FRAME_TOOL_NAME, createFrameToolDefinition } from './create-frame.js';
import { CREATE_RECTANGLE_TOOL_NAME, createRectangleToolDefinition } from './create-rectangle.js';
import { CREATE_TEXT_TOOL_NAME, createTextToolDefinition } from './create-text.js';
import { DELETE_NODES_TOOL_NAME, deleteNodesToolDefinition } from './delete-nodes.js';
import { LOCK_NODES_TOOL_NAME, lockNodesToolDefinition } from './lock-nodes.js';
import { MOVE_NODES_TOOL_NAME, moveNodesToolDefinition } from './move-nodes.js';
import { RENAME_NODE_TOOL_NAME, renameNodeToolDefinition } from './rename-node.js';
import { RESIZE_NODES_TOOL_NAME, resizeNodesToolDefinition } from './resize-nodes.js';
import { ROTATE_NODES_TOOL_NAME, rotateNodesToolDefinition } from './rotate-nodes.js';
import { SET_AUTO_LAYOUT_TOOL_NAME, setAutoLayoutToolDefinition } from './set-auto-layout.js';
import { SET_BLEND_MODE_TOOL_NAME, setBlendModeToolDefinition } from './set-blend-mode.js';
import { SET_CONSTRAINTS_TOOL_NAME, setConstraintsToolDefinition } from './set-constraints.js';
import { SET_CORNER_RADIUS_TOOL_NAME, setCornerRadiusToolDefinition } from './set-corner-radius.js';
import { SET_FILLS_TOOL_NAME, setFillsToolDefinition } from './set-fills.js';
import { SET_OPACITY_TOOL_NAME, setOpacityToolDefinition } from './set-opacity.js';
import { SET_STROKES_TOOL_NAME, setStrokesToolDefinition } from './set-strokes.js';
import { SET_TEXT_TOOL_NAME, setTextToolDefinition } from './set-text.js';
import { SET_VISIBLE_TOOL_NAME, setVisibleToolDefinition } from './set-visible.js';
import { UNLOCK_NODES_TOOL_NAME, unlockNodesToolDefinition } from './unlock-nodes.js';
import { SET_EFFECTS_TOOL_NAME, setEffectsToolDefinition } from './set-effects.js';
import { CREATE_PAINT_STYLE_TOOL_NAME, createPaintStyleToolDefinition } from './create-paint-style.js';
import { CREATE_TEXT_STYLE_TOOL_NAME, createTextStyleToolDefinition } from './create-text-style.js';
import { CREATE_EFFECT_STYLE_TOOL_NAME, createEffectStyleToolDefinition } from './create-effect-style.js';
import { CREATE_GRID_STYLE_TOOL_NAME, createGridStyleToolDefinition } from './create-grid-style.js';
import { UPDATE_PAINT_STYLE_TOOL_NAME, updatePaintStyleToolDefinition } from './update-paint-style.js';
import { APPLY_STYLE_TO_NODE_TOOL_NAME, applyStyleToNodeToolDefinition } from './apply-style-to-node.js';
import { DELETE_STYLE_TOOL_NAME, deleteStyleToolDefinition } from './delete-style.js';
import {
  CREATE_VARIABLE_COLLECTION_TOOL_NAME,
  createVariableCollectionToolDefinition,
} from './create-variable-collection.js';
import { ADD_VARIABLE_MODE_TOOL_NAME, addVariableModeToolDefinition } from './add-variable-mode.js';
import { CREATE_VARIABLE_TOOL_NAME, createVariableToolDefinition } from './create-variable.js';
import { SET_VARIABLE_VALUE_TOOL_NAME, setVariableValueToolDefinition } from './set-variable-value.js';
import { SET_TEXT_PROPERTIES_TOOL_NAME, setTextPropertiesToolDefinition } from './set-text-properties.js';
import { BIND_VARIABLE_TO_NODE_TOOL_NAME, bindVariableToNodeToolDefinition } from './bind-variable-to-node.js';
import { DELETE_VARIABLE_TOOL_NAME, deleteVariableToolDefinition } from './delete-variable.js';
import { GROUP_NODES_TOOL_NAME, groupNodesToolDefinition } from './group-nodes.js';
import { UNGROUP_NODES_TOOL_NAME, ungroupNodesToolDefinition } from './ungroup-nodes.js';
import { REPARENT_NODES_TOOL_NAME, reparentNodesToolDefinition } from './reparent-nodes.js';
import { REORDER_NODES_TOOL_NAME, reorderNodesToolDefinition } from './reorder-nodes.js';
import { FIND_REPLACE_TEXT_TOOL_NAME, findReplaceTextToolDefinition } from './find-replace-text.js';
import { BATCH_RENAME_NODES_TOOL_NAME, batchRenameNodesToolDefinition } from './batch-rename-nodes.js';
import { ADD_PAGE_TOOL_NAME, addPageToolDefinition } from './add-page.js';
import { DELETE_PAGE_TOOL_NAME, deletePageToolDefinition } from './delete-page.js';
import { RENAME_PAGE_TOOL_NAME, renamePageToolDefinition } from './rename-page.js';
import { NAVIGATE_TO_PAGE_TOOL_NAME, navigateToPageToolDefinition } from './navigate-to-page.js';
import { SET_REACTIONS_TOOL_NAME, setReactionsToolDefinition } from './set-reactions.js';
import { REMOVE_REACTIONS_TOOL_NAME, removeReactionsToolDefinition } from './remove-reactions.js';
import { SWAP_COMPONENT_TOOL_NAME, swapComponentToolDefinition } from './swap-component.js';
import { DETACH_INSTANCE_TOOL_NAME, detachInstanceToolDefinition } from './detach-instance.js';
import { IMPORT_IMAGE_TOOL_NAME, importImageToolDefinition } from './import-image.js';
import { CREATE_ELLIPSE_TOOL_NAME, createEllipseToolDefinition } from './create-ellipse.js';
import { CREATE_COMPONENT_TOOL_NAME, createComponentToolDefinition } from './create-component.js';
import { CREATE_SECTION_TOOL_NAME, createSectionToolDefinition } from './create-section.js';
import { CREATE_INSTANCE_TOOL_NAME, createInstanceToolDefinition } from './create-instance.js';
import { BATCH_TOOL_NAME, batchToolDefinition } from './batch.js';

/** Every tool the MCP server advertises, in ListTools order. */
export const TOOL_DEFINITIONS: readonly Tool[] = [
  // Reads
  pingToolDefinition,
  getSelectionToolDefinition,
  getDocumentToolDefinition,
  getNodeToolDefinition,
  getNodesInfoToolDefinition,
  getMetadataToolDefinition,
  getPagesToolDefinition,
  searchNodesToolDefinition,
  scanTextNodesToolDefinition,
  scanNodesByTypesToolDefinition,
  getStylesToolDefinition,
  getVariableDefsToolDefinition,
  getLocalComponentsToolDefinition,
  getViewportToolDefinition,
  getFontsToolDefinition,
  getAnnotationsToolDefinition,
  getReactionsToolDefinition,
  listFilesToolDefinition,
  getDesignContextToolDefinition,
  getScreenshotToolDefinition,
  saveScreenshotsToolDefinition,
  // Server-local (filesystem; no plugin handler — like save_screenshots)
  analyzeProjectToolDefinition,
  scanComponentsToolDefinition,
  // Writes
  setFillsToolDefinition,
  setTextToolDefinition,
  setTextPropertiesToolDefinition,
  createFrameToolDefinition,
  setOpacityToolDefinition,
  setVisibleToolDefinition,
  renameNodeToolDefinition,
  deleteNodesToolDefinition,
  createTextToolDefinition,
  createRectangleToolDefinition,
  setCornerRadiusToolDefinition,
  setStrokesToolDefinition,
  moveNodesToolDefinition,
  resizeNodesToolDefinition,
  setAutoLayoutToolDefinition,
  setBlendModeToolDefinition,
  setConstraintsToolDefinition,
  rotateNodesToolDefinition,
  lockNodesToolDefinition,
  unlockNodesToolDefinition,
  cloneNodeToolDefinition,
  setEffectsToolDefinition,
  createPaintStyleToolDefinition,
  createTextStyleToolDefinition,
  createEffectStyleToolDefinition,
  createGridStyleToolDefinition,
  updatePaintStyleToolDefinition,
  applyStyleToNodeToolDefinition,
  deleteStyleToolDefinition,
  createVariableCollectionToolDefinition,
  addVariableModeToolDefinition,
  createVariableToolDefinition,
  setVariableValueToolDefinition,
  bindVariableToNodeToolDefinition,
  deleteVariableToolDefinition,
  groupNodesToolDefinition,
  ungroupNodesToolDefinition,
  reparentNodesToolDefinition,
  reorderNodesToolDefinition,
  findReplaceTextToolDefinition,
  batchRenameNodesToolDefinition,
  addPageToolDefinition,
  deletePageToolDefinition,
  renamePageToolDefinition,
  navigateToPageToolDefinition,
  setReactionsToolDefinition,
  removeReactionsToolDefinition,
  swapComponentToolDefinition,
  detachInstanceToolDefinition,
  importImageToolDefinition,
  createEllipseToolDefinition,
  createComponentToolDefinition,
  createSectionToolDefinition,
  createInstanceToolDefinition,
  batchToolDefinition,
];

/**
 * Write tools get a server-generated requestId (stable across dispatch retries) so the plugin can
 * dedupe side-effects. Reads don't need it.
 */
export const WRITE_TOOL_NAMES: ReadonlySet<string> = new Set<string>([
  SET_FILLS_TOOL_NAME,
  SET_TEXT_TOOL_NAME,
  SET_TEXT_PROPERTIES_TOOL_NAME,
  CREATE_FRAME_TOOL_NAME,
  SET_OPACITY_TOOL_NAME,
  SET_VISIBLE_TOOL_NAME,
  RENAME_NODE_TOOL_NAME,
  DELETE_NODES_TOOL_NAME,
  CREATE_TEXT_TOOL_NAME,
  CREATE_RECTANGLE_TOOL_NAME,
  SET_CORNER_RADIUS_TOOL_NAME,
  SET_STROKES_TOOL_NAME,
  MOVE_NODES_TOOL_NAME,
  RESIZE_NODES_TOOL_NAME,
  SET_AUTO_LAYOUT_TOOL_NAME,
  SET_BLEND_MODE_TOOL_NAME,
  SET_CONSTRAINTS_TOOL_NAME,
  ROTATE_NODES_TOOL_NAME,
  LOCK_NODES_TOOL_NAME,
  UNLOCK_NODES_TOOL_NAME,
  CLONE_NODE_TOOL_NAME,
  SET_EFFECTS_TOOL_NAME,
  CREATE_PAINT_STYLE_TOOL_NAME,
  CREATE_TEXT_STYLE_TOOL_NAME,
  CREATE_EFFECT_STYLE_TOOL_NAME,
  CREATE_GRID_STYLE_TOOL_NAME,
  UPDATE_PAINT_STYLE_TOOL_NAME,
  APPLY_STYLE_TO_NODE_TOOL_NAME,
  DELETE_STYLE_TOOL_NAME,
  CREATE_VARIABLE_COLLECTION_TOOL_NAME,
  ADD_VARIABLE_MODE_TOOL_NAME,
  CREATE_VARIABLE_TOOL_NAME,
  SET_VARIABLE_VALUE_TOOL_NAME,
  BIND_VARIABLE_TO_NODE_TOOL_NAME,
  DELETE_VARIABLE_TOOL_NAME,
  GROUP_NODES_TOOL_NAME,
  UNGROUP_NODES_TOOL_NAME,
  REPARENT_NODES_TOOL_NAME,
  REORDER_NODES_TOOL_NAME,
  FIND_REPLACE_TEXT_TOOL_NAME,
  BATCH_RENAME_NODES_TOOL_NAME,
  ADD_PAGE_TOOL_NAME,
  DELETE_PAGE_TOOL_NAME,
  RENAME_PAGE_TOOL_NAME,
  NAVIGATE_TO_PAGE_TOOL_NAME,
  SET_REACTIONS_TOOL_NAME,
  REMOVE_REACTIONS_TOOL_NAME,
  SWAP_COMPONENT_TOOL_NAME,
  DETACH_INSTANCE_TOOL_NAME,
  IMPORT_IMAGE_TOOL_NAME,
  CREATE_ELLIPSE_TOOL_NAME,
  CREATE_COMPONENT_TOOL_NAME,
  CREATE_SECTION_TOOL_NAME,
  CREATE_INSTANCE_TOOL_NAME,
  BATCH_TOOL_NAME,
]);
