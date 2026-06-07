import type { SandboxHandlers } from '../dispatcher.js';
import { createIdempotencyCache, idempotent } from '../idempotency.js';
import { createAddPageHandler } from './add-page.js';
import { createAddVariableModeHandler } from './add-variable-mode.js';
import { createApplyStyleToNodeHandler } from './apply-style-to-node.js';
import { createBatchRenameNodesHandler } from './batch-rename-nodes.js';
import { createBatchHandler } from './batch.js';
import { createBindVariableToNodeHandler } from './bind-variable-to-node.js';
import { createCloneNodeHandler } from './clone-node.js';
import { createCombineAsVariantsHandler } from './combine-as-variants.js';
import { createCreateComponentHandler } from './create-component.js';
import { createCreateEffectStyleHandler } from './create-effect-style.js';
import { createCreateEllipseHandler } from './create-ellipse.js';
import { createCreateFrameHandler } from './create-frame.js';
import { createCreateGridStyleHandler } from './create-grid-style.js';
import { createCreateInstanceHandler } from './create-instance.js';
import { createCreatePaintStyleHandler } from './create-paint-style.js';
import { createCreateRectangleHandler } from './create-rectangle.js';
import { createCreateSectionHandler } from './create-section.js';
import { createCreateTextStyleHandler } from './create-text-style.js';
import { createCreateTextHandler } from './create-text.js';
import { createCreateVariableCollectionHandler } from './create-variable-collection.js';
import { createCreateVariableHandler } from './create-variable.js';
import { createDeleteNodesHandler } from './delete-nodes.js';
import { createDeletePageHandler } from './delete-page.js';
import { createDeleteStyleHandler } from './delete-style.js';
import { createDeleteVariableHandler } from './delete-variable.js';
import { createDetachInstanceHandler } from './detach-instance.js';
import { createFindReplaceTextHandler } from './find-replace-text.js';
import { createGetAnnotationsHandler } from './get-annotations.js';
import { createGetDesignContextHandler } from './get-design-context.js';
import { createGetDocumentHandler } from './get-document.js';
import { createGetFontsHandler } from './get-fonts.js';
import { createGetLocalComponentsHandler } from './get-local-components.js';
import { createGetMetadataHandler } from './get-metadata.js';
import { createGetNodeHandler } from './get-node.js';
import { createGetNodesInfoHandler } from './get-nodes-info.js';
import { createGetPagesHandler } from './get-pages.js';
import { createGetReactionsHandler } from './get-reactions.js';
import { createGetScreenshotHandler } from './get-screenshot.js';
import { createGetSelectionHandler } from './get-selection.js';
import { createGetStylesHandler } from './get-styles.js';
import { createGetVariableDefsHandler } from './get-variable-defs.js';
import { createGetViewportHandler } from './get-viewport.js';
import { createGroupNodesHandler } from './group-nodes.js';
import { createImportImageHandler } from './import-image.js';
import { createListFilesHandler } from './list-files.js';
import { createSetLockedHandler } from './lock-nodes.js';
import { createMoveNodesHandler } from './move-nodes.js';
import { createNavigateToPageHandler } from './navigate-to-page.js';
import { createPingHandler } from './ping.js';
import { createRemoveReactionsHandler } from './remove-reactions.js';
import { createRenameNodeHandler } from './rename-node.js';
import { createRenamePageHandler } from './rename-page.js';
import { createRenameVariableHandler } from './rename-variable.js';
import { createReorderNodesHandler } from './reorder-nodes.js';
import { createReparentNodesHandler } from './reparent-nodes.js';
import { createResizeNodesHandler } from './resize-nodes.js';
import { createRotateNodesHandler } from './rotate-nodes.js';
import { createScanNodesByTypesHandler } from './scan-nodes-by-types.js';
import { createScanTextNodesHandler } from './scan-text-nodes.js';
import { createSearchNodesHandler } from './search-nodes.js';
import { createSetAutoLayoutHandler } from './set-auto-layout.js';
import { createSetBlendModeHandler } from './set-blend-mode.js';
import { createSetConstraintsHandler } from './set-constraints.js';
import { createSetCornerRadiusHandler } from './set-corner-radius.js';
import { createSetEffectsHandler } from './set-effects.js';
import { createSetFillsHandler } from './set-fills.js';
import { createSetLayoutPropsHandler } from './set-layout-props.js';
import { createSetOpacityHandler } from './set-opacity.js';
import { createSetReactionsHandler } from './set-reactions.js';
import { createSetStrokesHandler } from './set-strokes.js';
import { createSetTextPropertiesHandler } from './set-text-properties.js';
import { createSetTextHandler } from './set-text.js';
import { createSetVariableValueHandler } from './set-variable-value.js';
import { createSetVisibleHandler } from './set-visible.js';
import { createSwapComponentHandler } from './swap-component.js';
import { createUngroupNodesHandler } from './ungroup-nodes.js';
import { createUpdatePaintStyleHandler } from './update-paint-style.js';

/**
 * Build the full sandbox handler map. Read handlers run as-is; write handlers are wrapped with
 * idempotency (same requestId applies once). `batch` calls the un-wrapped writes directly — it
 * carries one requestId and is itself idempotent, so per-op deduping would double-count.
 *
 * Wiring lives here (not in code.ts) so a registry test can enumerate the keys and assert they
 * match the server's advertised tools — a new tool can't be half-wired without a test failing.
 */
export const createSandboxHandlers = (figmaCtx: typeof figma): SandboxHandlers => {
  const cache = createIdempotencyCache();

  const rawWrites: SandboxHandlers = {
    set_fills: createSetFillsHandler(figmaCtx),
    set_text: createSetTextHandler(figmaCtx),
    set_text_properties: createSetTextPropertiesHandler(figmaCtx),
    create_frame: createCreateFrameHandler(figmaCtx),
    set_opacity: createSetOpacityHandler(figmaCtx),
    set_visible: createSetVisibleHandler(figmaCtx),
    rename_node: createRenameNodeHandler(figmaCtx),
    delete_nodes: createDeleteNodesHandler(figmaCtx),
    create_text: createCreateTextHandler(figmaCtx),
    create_rectangle: createCreateRectangleHandler(figmaCtx),
    set_corner_radius: createSetCornerRadiusHandler(figmaCtx),
    set_strokes: createSetStrokesHandler(figmaCtx),
    move_nodes: createMoveNodesHandler(figmaCtx),
    resize_nodes: createResizeNodesHandler(figmaCtx),
    set_auto_layout: createSetAutoLayoutHandler(figmaCtx),
    set_layout_props: createSetLayoutPropsHandler(figmaCtx),
    set_blend_mode: createSetBlendModeHandler(figmaCtx),
    set_constraints: createSetConstraintsHandler(figmaCtx),
    rotate_nodes: createRotateNodesHandler(figmaCtx),
    lock_nodes: createSetLockedHandler(figmaCtx, true),
    unlock_nodes: createSetLockedHandler(figmaCtx, false),
    clone_node: createCloneNodeHandler(figmaCtx),
    // Styles
    set_effects: createSetEffectsHandler(figmaCtx),
    create_paint_style: createCreatePaintStyleHandler(figmaCtx),
    create_text_style: createCreateTextStyleHandler(figmaCtx),
    create_effect_style: createCreateEffectStyleHandler(figmaCtx),
    create_grid_style: createCreateGridStyleHandler(figmaCtx),
    update_paint_style: createUpdatePaintStyleHandler(figmaCtx),
    apply_style_to_node: createApplyStyleToNodeHandler(figmaCtx),
    delete_style: createDeleteStyleHandler(figmaCtx),
    // Variables
    create_variable_collection: createCreateVariableCollectionHandler(figmaCtx),
    add_variable_mode: createAddVariableModeHandler(figmaCtx),
    create_variable: createCreateVariableHandler(figmaCtx),
    set_variable_value: createSetVariableValueHandler(figmaCtx),
    bind_variable_to_node: createBindVariableToNodeHandler(figmaCtx),
    rename_variable: createRenameVariableHandler(figmaCtx),
    delete_variable: createDeleteVariableHandler(figmaCtx),
    // Structure + bulk text
    group_nodes: createGroupNodesHandler(figmaCtx),
    ungroup_nodes: createUngroupNodesHandler(figmaCtx),
    reparent_nodes: createReparentNodesHandler(figmaCtx),
    reorder_nodes: createReorderNodesHandler(figmaCtx),
    find_replace_text: createFindReplaceTextHandler(figmaCtx),
    batch_rename_nodes: createBatchRenameNodesHandler(figmaCtx),
    // Pages
    add_page: createAddPageHandler(figmaCtx),
    delete_page: createDeletePageHandler(figmaCtx),
    rename_page: createRenamePageHandler(figmaCtx),
    navigate_to_page: createNavigateToPageHandler(figmaCtx),
    // Prototype + components
    set_reactions: createSetReactionsHandler(figmaCtx),
    remove_reactions: createRemoveReactionsHandler(figmaCtx),
    swap_component: createSwapComponentHandler(figmaCtx),
    detach_instance: createDetachInstanceHandler(figmaCtx),
    import_image: createImportImageHandler(figmaCtx),
    create_ellipse: createCreateEllipseHandler(figmaCtx),
    create_component: createCreateComponentHandler(figmaCtx),
    create_section: createCreateSectionHandler(figmaCtx),
    create_instance: createCreateInstanceHandler(figmaCtx),
    combine_as_variants: createCombineAsVariantsHandler(figmaCtx),
  };

  const handlers: SandboxHandlers = {
    ping: createPingHandler(figmaCtx),
    get_selection: createGetSelectionHandler(figmaCtx),
    get_document: createGetDocumentHandler(figmaCtx),
    get_node: createGetNodeHandler(figmaCtx),
    get_nodes_info: createGetNodesInfoHandler(figmaCtx),
    get_metadata: createGetMetadataHandler(figmaCtx),
    get_pages: createGetPagesHandler(figmaCtx),
    search_nodes: createSearchNodesHandler(figmaCtx),
    scan_text_nodes: createScanTextNodesHandler(figmaCtx),
    scan_nodes_by_types: createScanNodesByTypesHandler(figmaCtx),
    get_styles: createGetStylesHandler(figmaCtx),
    get_variable_defs: createGetVariableDefsHandler(figmaCtx),
    get_local_components: createGetLocalComponentsHandler(figmaCtx),
    get_viewport: createGetViewportHandler(figmaCtx),
    get_fonts: createGetFontsHandler(figmaCtx),
    get_annotations: createGetAnnotationsHandler(figmaCtx),
    get_reactions: createGetReactionsHandler(figmaCtx),
    list_files: createListFilesHandler(figmaCtx),
    get_design_context: createGetDesignContextHandler(figmaCtx),
    get_screenshot: createGetScreenshotHandler(figmaCtx),
  };

  for (const name of Object.keys(rawWrites)) {
    handlers[name] = idempotent(cache, rawWrites[name]!);
  }
  handlers.batch = idempotent(cache, createBatchHandler(figmaCtx, rawWrites));

  return handlers;
};
