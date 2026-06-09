import { createPluginContextEvent, SELECTION_DETAIL_LIMIT } from '@figma-mcp-relay/shared';

import { dispatchSandboxMessage } from './dispatcher.js';
import { createSandboxHandlers } from './handlers/registry.js';

figma.showUI(__html__, { width: 292, height: 312, themeColors: true });

// "Run in background" hides the panel (figma.ui.hide keeps this iframe + the relay socket alive, so
// the connection survives). Running the plugin again from the Plugins menu re-reveals it.
figma.on('run', () => figma.ui.show());

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

const handlers = createSandboxHandlers(figma);

figma.ui.onmessage = (raw: unknown) => {
  // UI control: hide the panel into the background (relay stays connected). Handled locally, not
  // routed to tool dispatch.
  if (
    typeof raw === 'object' &&
    raw !== null &&
    (raw as { type?: unknown }).type === 'ui:minimize'
  ) {
    figma.ui.hide();
    return;
  }
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
