import { createPluginContextEvent, SELECTION_DETAIL_LIMIT } from '@figma-mcp-relay/shared';

import { dispatchSandboxMessage, type SandboxHandlers } from './dispatcher.js';
import { createIdempotencyCache, idempotent } from './idempotency.js';
import { createBatchHandler } from './handlers/batch.js';
import { createAddPageHandler } from './handlers/add-page.js';
import { createAddVariableModeHandler } from './handlers/add-variable-mode.js';
import { createApplyStyleToNodeHandler } from './handlers/apply-style-to-node.js';
import { createBatchRenameNodesHandler } from './handlers/batch-rename-nodes.js';
import { createBindVariableToNodeHandler } from './handlers/bind-variable-to-node.js';
import { createCloneNodeHandler } from './handlers/clone-node.js';
import { createCreateComponentHandler } from './handlers/create-component.js';
import { createCreateEffectStyleHandler } from './handlers/create-effect-style.js';
import { createCreateEllipseHandler } from './handlers/create-ellipse.js';
import { createCreateFrameHandler } from './handlers/create-frame.js';
import { createCreateGridStyleHandler } from './handlers/create-grid-style.js';
import { createCreatePaintStyleHandler } from './handlers/create-paint-style.js';
import { createCreateRectangleHandler } from './handlers/create-rectangle.js';
import { createCreateSectionHandler } from './handlers/create-section.js';
import { createCreateInstanceHandler } from './handlers/create-instance.js';
import { createCreateTextHandler } from './handlers/create-text.js';
import { createCreateTextStyleHandler } from './handlers/create-text-style.js';
import { createCreateVariableHandler } from './handlers/create-variable.js';
import { createCreateVariableCollectionHandler } from './handlers/create-variable-collection.js';
import { createDeleteNodesHandler } from './handlers/delete-nodes.js';
import { createDeletePageHandler } from './handlers/delete-page.js';
import { createDeleteStyleHandler } from './handlers/delete-style.js';
import { createDeleteVariableHandler } from './handlers/delete-variable.js';
import { createDetachInstanceHandler } from './handlers/detach-instance.js';
import { createFindReplaceTextHandler } from './handlers/find-replace-text.js';
import { createGroupNodesHandler } from './handlers/group-nodes.js';
import { createImportImageHandler } from './handlers/import-image.js';
import { createNavigateToPageHandler } from './handlers/navigate-to-page.js';
import { createGetAnnotationsHandler } from './handlers/get-annotations.js';
import { createGetDesignContextHandler } from './handlers/get-design-context.js';
import { createGetDocumentHandler } from './handlers/get-document.js';
import { createGetFontsHandler } from './handlers/get-fonts.js';
import { createGetLocalComponentsHandler } from './handlers/get-local-components.js';
import { createGetMetadataHandler } from './handlers/get-metadata.js';
import { createGetNodeHandler } from './handlers/get-node.js';
import { createGetNodesInfoHandler } from './handlers/get-nodes-info.js';
import { createGetPagesHandler } from './handlers/get-pages.js';
import { createGetReactionsHandler } from './handlers/get-reactions.js';
import { createGetScreenshotHandler } from './handlers/get-screenshot.js';
import { createGetSelectionHandler } from './handlers/get-selection.js';
import { createGetStylesHandler } from './handlers/get-styles.js';
import { createGetVariableDefsHandler } from './handlers/get-variable-defs.js';
import { createGetViewportHandler } from './handlers/get-viewport.js';
import { createListFilesHandler } from './handlers/list-files.js';
import { createPingHandler } from './handlers/ping.js';
import { createScanNodesByTypesHandler } from './handlers/scan-nodes-by-types.js';
import { createScanTextNodesHandler } from './handlers/scan-text-nodes.js';
import { createSearchNodesHandler } from './handlers/search-nodes.js';
import { createSetLockedHandler } from './handlers/lock-nodes.js';
import { createMoveNodesHandler } from './handlers/move-nodes.js';
import { createRemoveReactionsHandler } from './handlers/remove-reactions.js';
import { createRenameNodeHandler } from './handlers/rename-node.js';
import { createRenamePageHandler } from './handlers/rename-page.js';
import { createReorderNodesHandler } from './handlers/reorder-nodes.js';
import { createReparentNodesHandler } from './handlers/reparent-nodes.js';
import { createResizeNodesHandler } from './handlers/resize-nodes.js';
import { createRotateNodesHandler } from './handlers/rotate-nodes.js';
import { createSetAutoLayoutHandler } from './handlers/set-auto-layout.js';
import { createSetBlendModeHandler } from './handlers/set-blend-mode.js';
import { createSetConstraintsHandler } from './handlers/set-constraints.js';
import { createSetCornerRadiusHandler } from './handlers/set-corner-radius.js';
import { createSetEffectsHandler } from './handlers/set-effects.js';
import { createSetReactionsHandler } from './handlers/set-reactions.js';
import { createSetFillsHandler } from './handlers/set-fills.js';
import { createSetOpacityHandler } from './handlers/set-opacity.js';
import { createSetStrokesHandler } from './handlers/set-strokes.js';
import { createSetTextHandler } from './handlers/set-text.js';
import { createSetVariableValueHandler } from './handlers/set-variable-value.js';
import { createSetVisibleHandler } from './handlers/set-visible.js';
import { createSwapComponentHandler } from './handlers/swap-component.js';
import { createUngroupNodesHandler } from './handlers/ungroup-nodes.js';
import { createUpdatePaintStyleHandler } from './handlers/update-paint-style.js';

figma.showUI(__html__, { width: 320, height: 400, themeColors: true });

const log = (msg: string): void => console.log(msg);

// Push the current Figma context to the UI so its Context tab reflects what the plugin sees.
const emitContext = (): void => {
  const page = figma.currentPage;
  const selection = page.selection.slice(0, SELECTION_DETAIL_LIMIT).map(n => ({
    id: n.id,
    name: n.name,
    type: n.type,
    width: 'width' in n ? Math.round(n.width) : 0,
    height: 'height' in n ? Math.round(n.height) : 0,
  }));
  const event = createPluginContextEvent({
    fileName: figma.root.name,
    pageId: page.id,
    pageName: page.name,
    selectionCount: page.selection.length,
    selection,
    editorType: figma.editorType,
    apiVersion: figma.apiVersion,
  });
  // figma.ui.postMessage is the Figma plugin API — there is no targetOrigin parameter
  // eslint-disable-next-line unicorn/require-post-message-target-origin
  figma.ui.postMessage(event);
};

const idempotencyCache = createIdempotencyCache();

// Raw (un-wrapped) write handlers. `batch` calls these directly: a batch carries one requestId and
// is itself idempotent, so its ops must not be deduped a second time per-op.
const rawWrites: SandboxHandlers = {
  set_fills: createSetFillsHandler(figma),
  set_text: createSetTextHandler(figma),
  create_frame: createCreateFrameHandler(figma),
  set_opacity: createSetOpacityHandler(figma),
  set_visible: createSetVisibleHandler(figma),
  rename_node: createRenameNodeHandler(figma),
  delete_nodes: createDeleteNodesHandler(figma),
  create_text: createCreateTextHandler(figma),
  create_rectangle: createCreateRectangleHandler(figma),
  set_corner_radius: createSetCornerRadiusHandler(figma),
  set_strokes: createSetStrokesHandler(figma),
  move_nodes: createMoveNodesHandler(figma),
  resize_nodes: createResizeNodesHandler(figma),
  set_auto_layout: createSetAutoLayoutHandler(figma),
  set_blend_mode: createSetBlendModeHandler(figma),
  set_constraints: createSetConstraintsHandler(figma),
  rotate_nodes: createRotateNodesHandler(figma),
  lock_nodes: createSetLockedHandler(figma, true),
  unlock_nodes: createSetLockedHandler(figma, false),
  clone_node: createCloneNodeHandler(figma),
  // Styles
  set_effects: createSetEffectsHandler(figma),
  create_paint_style: createCreatePaintStyleHandler(figma),
  create_text_style: createCreateTextStyleHandler(figma),
  create_effect_style: createCreateEffectStyleHandler(figma),
  create_grid_style: createCreateGridStyleHandler(figma),
  update_paint_style: createUpdatePaintStyleHandler(figma),
  apply_style_to_node: createApplyStyleToNodeHandler(figma),
  delete_style: createDeleteStyleHandler(figma),
  // Variables
  create_variable_collection: createCreateVariableCollectionHandler(figma),
  add_variable_mode: createAddVariableModeHandler(figma),
  create_variable: createCreateVariableHandler(figma),
  set_variable_value: createSetVariableValueHandler(figma),
  bind_variable_to_node: createBindVariableToNodeHandler(figma),
  delete_variable: createDeleteVariableHandler(figma),
  // Structure + bulk text
  group_nodes: createGroupNodesHandler(figma),
  ungroup_nodes: createUngroupNodesHandler(figma),
  reparent_nodes: createReparentNodesHandler(figma),
  reorder_nodes: createReorderNodesHandler(figma),
  find_replace_text: createFindReplaceTextHandler(figma),
  batch_rename_nodes: createBatchRenameNodesHandler(figma),
  // Pages
  add_page: createAddPageHandler(figma),
  delete_page: createDeletePageHandler(figma),
  rename_page: createRenamePageHandler(figma),
  navigate_to_page: createNavigateToPageHandler(figma),
  // Prototype + components
  set_reactions: createSetReactionsHandler(figma),
  remove_reactions: createRemoveReactionsHandler(figma),
  swap_component: createSwapComponentHandler(figma),
  detach_instance: createDetachInstanceHandler(figma),
  import_image: createImportImageHandler(figma),
  create_ellipse: createCreateEllipseHandler(figma),
  create_component: createCreateComponentHandler(figma),
  create_section: createCreateSectionHandler(figma),
  create_instance: createCreateInstanceHandler(figma),
};

const handlers: SandboxHandlers = {
  ping: createPingHandler(figma),
  get_selection: createGetSelectionHandler(figma),
  get_document: createGetDocumentHandler(figma),
  get_node: createGetNodeHandler(figma),
  get_nodes_info: createGetNodesInfoHandler(figma),
  get_metadata: createGetMetadataHandler(figma),
  get_pages: createGetPagesHandler(figma),
  search_nodes: createSearchNodesHandler(figma),
  scan_text_nodes: createScanTextNodesHandler(figma),
  scan_nodes_by_types: createScanNodesByTypesHandler(figma),
  get_styles: createGetStylesHandler(figma),
  get_variable_defs: createGetVariableDefsHandler(figma),
  get_local_components: createGetLocalComponentsHandler(figma),
  get_viewport: createGetViewportHandler(figma),
  get_fonts: createGetFontsHandler(figma),
  get_annotations: createGetAnnotationsHandler(figma),
  get_reactions: createGetReactionsHandler(figma),
  list_files: createListFilesHandler(figma),
  get_design_context: createGetDesignContextHandler(figma),
  get_screenshot: createGetScreenshotHandler(figma),
};

// Write tools: wrapped with idempotency so retries (same requestId) apply the effect once.
for (const name of Object.keys(rawWrites)) {
  handlers[name] = idempotent(idempotencyCache, rawWrites[name]!);
}
// batch applies many invertible ops atomically (all-or-nothing). One requestId → idempotent as a unit.
handlers.batch = idempotent(idempotencyCache, createBatchHandler(figma, rawWrites));

figma.ui.onmessage = (raw: unknown) => {
  void (async (): Promise<void> => {
    const outcome = await dispatchSandboxMessage({ raw, handlers, log });
    if (outcome.kind === 'reply') {
      // figma.ui.postMessage is the Figma plugin API — there is no targetOrigin parameter
      // eslint-disable-next-line unicorn/require-post-message-target-origin
      figma.ui.postMessage(outcome.reply);
    }
  })();
};

emitContext();
figma.on('currentpagechange', emitContext);
figma.on('selectionchange', emitContext);
