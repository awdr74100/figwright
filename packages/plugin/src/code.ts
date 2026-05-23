import { createPluginContextEvent, SELECTION_DETAIL_LIMIT } from '@figma-mcp-relay/shared';

import { dispatchSandboxMessage, type SandboxHandlers } from './dispatcher.js';
import { createIdempotencyCache, idempotent } from './idempotency.js';
import { createCreateFrameHandler } from './handlers/create-frame.js';
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
import { createSetFillsHandler } from './handlers/set-fills.js';
import { createSetTextHandler } from './handlers/set-text.js';

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
