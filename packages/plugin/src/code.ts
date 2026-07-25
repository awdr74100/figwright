import { createPluginContextEvent, SELECTION_DETAIL_LIMIT } from '../protocol/bridge.js';
import { parsePanelControl } from '../protocol/panel-control.js';
import { dispatchSandboxMessage } from './dispatcher.js';
import { createSandboxHandlers } from './handlers/registry.js';
import { createPanelController } from './panel.js';

const log = (msg: string): void => console.log(msg);

const panel = createPanelController(figma);
panel.open(__html__);

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
  // Panel control (resize / hide / reveal) is driven by the user's own clicks, not the agent, so
  // it's carried out here and never produces a relay reply. Anything else is tool traffic.
  const control = parsePanelControl(raw);
  if (control !== null) {
    panel.apply(control);
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
