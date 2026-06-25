import { createPluginContextEvent, SELECTION_DETAIL_LIMIT } from '@figwright/shared';

import { dispatchSandboxMessage } from './dispatcher.js';
import { createSandboxHandlers } from './handlers/registry.js';

// The window opens at this size and never shrinks below the floor (keeps the header/footer layout
// intact). There's no max — Figma clamps the window to the canvas viewport.
const UI_SIZE_KEY = 'ui-size';
const DEFAULT_UI_SIZE = { width: 292, height: 312 };
const MIN_UI_SIZE = { width: 280, height: 300 };

const clampUiSize = (width: number, height: number): { width: number; height: number } => ({
  width: Math.max(MIN_UI_SIZE.width, Math.round(width)),
  height: Math.max(MIN_UI_SIZE.height, Math.round(height)),
});

figma.showUI(__html__, { ...DEFAULT_UI_SIZE, themeColors: true });

// Restore the last user-chosen size. clientStorage is async, so the window opens at the default and
// then snaps to the saved size; clamp defensively in case a stored value predates the current floor.
void (async (): Promise<void> => {
  try {
    const saved: unknown = await figma.clientStorage.getAsync(UI_SIZE_KEY);
    if (typeof saved !== 'object' || saved === null) return;
    const { width, height } = saved as { width?: unknown; height?: unknown };
    if (typeof width === 'number' && typeof height === 'number') {
      const size = clampUiSize(width, height);
      figma.ui.resize(size.width, size.height);
    }
  } catch {
    // No saved size (or storage unavailable) — keep the default.
  }
})();

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
  // UI control: live window resize from the drag handle. `persist` (sent on drag-release) saves the
  // final size so the next open restores it. Handled locally, not routed to tool dispatch.
  if (typeof raw === 'object' && raw !== null && (raw as { type?: unknown }).type === 'ui:resize') {
    const { width, height, persist } = raw as {
      width?: unknown;
      height?: unknown;
      persist?: unknown;
    };
    if (typeof width === 'number' && typeof height === 'number') {
      const size = clampUiSize(width, height);
      figma.ui.resize(size.width, size.height);
      if (persist === true) figma.clientStorage.setAsync(UI_SIZE_KEY, size).catch(() => {});
    }
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
