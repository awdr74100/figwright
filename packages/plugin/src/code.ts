import { createPluginContextEvent, SELECTION_DETAIL_LIMIT } from '@figma-mcp-relay/shared';

import { dispatchSandboxMessage, type SandboxHandlers } from './dispatcher.js';
import { createIdempotencyCache, idempotent } from './idempotency.js';
import { createAddVariableModeHandler } from './handlers/add-variable-mode.js';
import { createApplyStyleToNodeHandler } from './handlers/apply-style-to-node.js';
import { createBatchRenameNodesHandler } from './handlers/batch-rename-nodes.js';
import { createBindVariableToNodeHandler } from './handlers/bind-variable-to-node.js';
import { createCloneNodeHandler } from './handlers/clone-node.js';
import { createCreateEffectStyleHandler } from './handlers/create-effect-style.js';
import { createCreateFrameHandler } from './handlers/create-frame.js';
import { createCreateGridStyleHandler } from './handlers/create-grid-style.js';
import { createCreatePaintStyleHandler } from './handlers/create-paint-style.js';
import { createCreateRectangleHandler } from './handlers/create-rectangle.js';
import { createCreateTextHandler } from './handlers/create-text.js';
import { createCreateTextStyleHandler } from './handlers/create-text-style.js';
import { createCreateVariableHandler } from './handlers/create-variable.js';
import { createCreateVariableCollectionHandler } from './handlers/create-variable-collection.js';
import { createDeleteNodesHandler } from './handlers/delete-nodes.js';
import { createDeleteStyleHandler } from './handlers/delete-style.js';
import { createDeleteVariableHandler } from './handlers/delete-variable.js';
import { createFindReplaceTextHandler } from './handlers/find-replace-text.js';
import { createGroupNodesHandler } from './handlers/group-nodes.js';
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
import { createRenameNodeHandler } from './handlers/rename-node.js';
import { createReorderNodesHandler } from './handlers/reorder-nodes.js';
import { createReparentNodesHandler } from './handlers/reparent-nodes.js';
import { createResizeNodesHandler } from './handlers/resize-nodes.js';
import { createRotateNodesHandler } from './handlers/rotate-nodes.js';
import { createSetAutoLayoutHandler } from './handlers/set-auto-layout.js';
import { createSetBlendModeHandler } from './handlers/set-blend-mode.js';
import { createSetConstraintsHandler } from './handlers/set-constraints.js';
import { createSetCornerRadiusHandler } from './handlers/set-corner-radius.js';
import { createSetEffectsHandler } from './handlers/set-effects.js';
import { createSetFillsHandler } from './handlers/set-fills.js';
import { createSetOpacityHandler } from './handlers/set-opacity.js';
import { createSetStrokesHandler } from './handlers/set-strokes.js';
import { createSetTextHandler } from './handlers/set-text.js';
import { createSetVariableValueHandler } from './handlers/set-variable-value.js';
import { createSetVisibleHandler } from './handlers/set-visible.js';
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
  // Write tools: wrapped with idempotency so retries (same requestId) apply the effect once.
  set_fills: idempotent(idempotencyCache, createSetFillsHandler(figma)),
  set_text: idempotent(idempotencyCache, createSetTextHandler(figma)),
  create_frame: idempotent(idempotencyCache, createCreateFrameHandler(figma)),
  set_opacity: idempotent(idempotencyCache, createSetOpacityHandler(figma)),
  set_visible: idempotent(idempotencyCache, createSetVisibleHandler(figma)),
  rename_node: idempotent(idempotencyCache, createRenameNodeHandler(figma)),
  delete_nodes: idempotent(idempotencyCache, createDeleteNodesHandler(figma)),
  create_text: idempotent(idempotencyCache, createCreateTextHandler(figma)),
  create_rectangle: idempotent(idempotencyCache, createCreateRectangleHandler(figma)),
  set_corner_radius: idempotent(idempotencyCache, createSetCornerRadiusHandler(figma)),
  set_strokes: idempotent(idempotencyCache, createSetStrokesHandler(figma)),
  move_nodes: idempotent(idempotencyCache, createMoveNodesHandler(figma)),
  resize_nodes: idempotent(idempotencyCache, createResizeNodesHandler(figma)),
  set_auto_layout: idempotent(idempotencyCache, createSetAutoLayoutHandler(figma)),
  set_blend_mode: idempotent(idempotencyCache, createSetBlendModeHandler(figma)),
  set_constraints: idempotent(idempotencyCache, createSetConstraintsHandler(figma)),
  rotate_nodes: idempotent(idempotencyCache, createRotateNodesHandler(figma)),
  lock_nodes: idempotent(idempotencyCache, createSetLockedHandler(figma, true)),
  unlock_nodes: idempotent(idempotencyCache, createSetLockedHandler(figma, false)),
  clone_node: idempotent(idempotencyCache, createCloneNodeHandler(figma)),
  // Styles
  set_effects: idempotent(idempotencyCache, createSetEffectsHandler(figma)),
  create_paint_style: idempotent(idempotencyCache, createCreatePaintStyleHandler(figma)),
  create_text_style: idempotent(idempotencyCache, createCreateTextStyleHandler(figma)),
  create_effect_style: idempotent(idempotencyCache, createCreateEffectStyleHandler(figma)),
  create_grid_style: idempotent(idempotencyCache, createCreateGridStyleHandler(figma)),
  update_paint_style: idempotent(idempotencyCache, createUpdatePaintStyleHandler(figma)),
  apply_style_to_node: idempotent(idempotencyCache, createApplyStyleToNodeHandler(figma)),
  delete_style: idempotent(idempotencyCache, createDeleteStyleHandler(figma)),
  // Variables
  create_variable_collection: idempotent(idempotencyCache, createCreateVariableCollectionHandler(figma)),
  add_variable_mode: idempotent(idempotencyCache, createAddVariableModeHandler(figma)),
  create_variable: idempotent(idempotencyCache, createCreateVariableHandler(figma)),
  set_variable_value: idempotent(idempotencyCache, createSetVariableValueHandler(figma)),
  bind_variable_to_node: idempotent(idempotencyCache, createBindVariableToNodeHandler(figma)),
  delete_variable: idempotent(idempotencyCache, createDeleteVariableHandler(figma)),
  // Structure + bulk text
  group_nodes: idempotent(idempotencyCache, createGroupNodesHandler(figma)),
  ungroup_nodes: idempotent(idempotencyCache, createUngroupNodesHandler(figma)),
  reparent_nodes: idempotent(idempotencyCache, createReparentNodesHandler(figma)),
  reorder_nodes: idempotent(idempotencyCache, createReorderNodesHandler(figma)),
  find_replace_text: idempotent(idempotencyCache, createFindReplaceTextHandler(figma)),
  batch_rename_nodes: idempotent(idempotencyCache, createBatchRenameNodesHandler(figma)),
};

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
