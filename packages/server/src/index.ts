import {
  DEFAULT_PORT,
  type GetScreenshotResult,
  newId,
  PROTOCOL_VERSION,
} from '@figma-mcp-relay/shared';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { dispatchTool } from './dispatch.js';
import { Election } from './election/election.js';
import { Follower } from './election/follower.js';
import { attachLeaderEndpoints } from './election/leader-endpoints.js';
import { Node, NodeRole } from './election/node.js';
import { getAnnotationsToolDefinition } from './tools/get-annotations.js';
import { getDesignContextToolDefinition } from './tools/get-design-context.js';
import { getDocumentToolDefinition } from './tools/get-document.js';
import { getFontsToolDefinition } from './tools/get-fonts.js';
import { getLocalComponentsToolDefinition } from './tools/get-local-components.js';
import { getMetadataToolDefinition } from './tools/get-metadata.js';
import { getNodeToolDefinition } from './tools/get-node.js';
import { getNodesInfoToolDefinition } from './tools/get-nodes-info.js';
import { getPagesToolDefinition } from './tools/get-pages.js';
import { getReactionsToolDefinition } from './tools/get-reactions.js';
import {
  GET_SCREENSHOT_TOOL_NAME,
  getScreenshotToolDefinition,
  screenshotContent,
} from './tools/get-screenshot.js';
import { getSelectionToolDefinition } from './tools/get-selection.js';
import { getStylesToolDefinition } from './tools/get-styles.js';
import { getVariableDefsToolDefinition } from './tools/get-variable-defs.js';
import { getViewportToolDefinition } from './tools/get-viewport.js';
import { listFilesToolDefinition } from './tools/list-files.js';
import { formatPingResult, handlePing, pingToolDefinition } from './tools/ping.js';
import {
  handleSaveScreenshots,
  SAVE_SCREENSHOTS_TOOL_NAME,
  saveScreenshotsToolDefinition,
} from './tools/save-screenshots.js';
import { scanNodesByTypesToolDefinition } from './tools/scan-nodes-by-types.js';
import { scanTextNodesToolDefinition } from './tools/scan-text-nodes.js';
import { searchNodesToolDefinition } from './tools/search-nodes.js';
import { CLONE_NODE_TOOL_NAME, cloneNodeToolDefinition } from './tools/clone-node.js';
import { CREATE_FRAME_TOOL_NAME, createFrameToolDefinition } from './tools/create-frame.js';
import { CREATE_RECTANGLE_TOOL_NAME, createRectangleToolDefinition } from './tools/create-rectangle.js';
import { CREATE_TEXT_TOOL_NAME, createTextToolDefinition } from './tools/create-text.js';
import { DELETE_NODES_TOOL_NAME, deleteNodesToolDefinition } from './tools/delete-nodes.js';
import { LOCK_NODES_TOOL_NAME, lockNodesToolDefinition } from './tools/lock-nodes.js';
import { MOVE_NODES_TOOL_NAME, moveNodesToolDefinition } from './tools/move-nodes.js';
import { RENAME_NODE_TOOL_NAME, renameNodeToolDefinition } from './tools/rename-node.js';
import { RESIZE_NODES_TOOL_NAME, resizeNodesToolDefinition } from './tools/resize-nodes.js';
import { ROTATE_NODES_TOOL_NAME, rotateNodesToolDefinition } from './tools/rotate-nodes.js';
import { SET_AUTO_LAYOUT_TOOL_NAME, setAutoLayoutToolDefinition } from './tools/set-auto-layout.js';
import { SET_BLEND_MODE_TOOL_NAME, setBlendModeToolDefinition } from './tools/set-blend-mode.js';
import { SET_CONSTRAINTS_TOOL_NAME, setConstraintsToolDefinition } from './tools/set-constraints.js';
import { SET_CORNER_RADIUS_TOOL_NAME, setCornerRadiusToolDefinition } from './tools/set-corner-radius.js';
import { SET_FILLS_TOOL_NAME, setFillsToolDefinition } from './tools/set-fills.js';
import { SET_OPACITY_TOOL_NAME, setOpacityToolDefinition } from './tools/set-opacity.js';
import { SET_STROKES_TOOL_NAME, setStrokesToolDefinition } from './tools/set-strokes.js';
import { SET_TEXT_TOOL_NAME, setTextToolDefinition } from './tools/set-text.js';
import { SET_VISIBLE_TOOL_NAME, setVisibleToolDefinition } from './tools/set-visible.js';
import { UNLOCK_NODES_TOOL_NAME, unlockNodesToolDefinition } from './tools/unlock-nodes.js';
import { SET_EFFECTS_TOOL_NAME, setEffectsToolDefinition } from './tools/set-effects.js';
import {
  CREATE_PAINT_STYLE_TOOL_NAME,
  createPaintStyleToolDefinition,
} from './tools/create-paint-style.js';
import {
  CREATE_TEXT_STYLE_TOOL_NAME,
  createTextStyleToolDefinition,
} from './tools/create-text-style.js';
import {
  CREATE_EFFECT_STYLE_TOOL_NAME,
  createEffectStyleToolDefinition,
} from './tools/create-effect-style.js';
import {
  CREATE_GRID_STYLE_TOOL_NAME,
  createGridStyleToolDefinition,
} from './tools/create-grid-style.js';
import {
  UPDATE_PAINT_STYLE_TOOL_NAME,
  updatePaintStyleToolDefinition,
} from './tools/update-paint-style.js';
import {
  APPLY_STYLE_TO_NODE_TOOL_NAME,
  applyStyleToNodeToolDefinition,
} from './tools/apply-style-to-node.js';
import { DELETE_STYLE_TOOL_NAME, deleteStyleToolDefinition } from './tools/delete-style.js';
import {
  CREATE_VARIABLE_COLLECTION_TOOL_NAME,
  createVariableCollectionToolDefinition,
} from './tools/create-variable-collection.js';
import {
  ADD_VARIABLE_MODE_TOOL_NAME,
  addVariableModeToolDefinition,
} from './tools/add-variable-mode.js';
import { CREATE_VARIABLE_TOOL_NAME, createVariableToolDefinition } from './tools/create-variable.js';
import {
  SET_VARIABLE_VALUE_TOOL_NAME,
  setVariableValueToolDefinition,
} from './tools/set-variable-value.js';
import {
  BIND_VARIABLE_TO_NODE_TOOL_NAME,
  bindVariableToNodeToolDefinition,
} from './tools/bind-variable-to-node.js';
import { DELETE_VARIABLE_TOOL_NAME, deleteVariableToolDefinition } from './tools/delete-variable.js';
import { GROUP_NODES_TOOL_NAME, groupNodesToolDefinition } from './tools/group-nodes.js';
import { UNGROUP_NODES_TOOL_NAME, ungroupNodesToolDefinition } from './tools/ungroup-nodes.js';
import { REPARENT_NODES_TOOL_NAME, reparentNodesToolDefinition } from './tools/reparent-nodes.js';
import { REORDER_NODES_TOOL_NAME, reorderNodesToolDefinition } from './tools/reorder-nodes.js';
import {
  FIND_REPLACE_TEXT_TOOL_NAME,
  findReplaceTextToolDefinition,
} from './tools/find-replace-text.js';
import {
  BATCH_RENAME_NODES_TOOL_NAME,
  batchRenameNodesToolDefinition,
} from './tools/batch-rename-nodes.js';

const SERVER_NAME = '@figma-mcp-relay/server';
const SERVER_VERSION = '0.0.0';

const log = (msg: string): void => {
  process.stderr.write(`${msg}\n`);
};

const node = new Node({ serverVersion: SERVER_VERSION, port: DEFAULT_PORT, log });
const follower = new Follower({ leaderUrl: node.leaderUrl, log });
const election = new Election({ node, follower, log });

let currentDetach: (() => void) | null = null;
node.onRoleChange(role => {
  if (currentDetach !== null) {
    currentDetach();
    currentDetach = null;
  }
  if (role === NodeRole.Leader) {
    const res = node.getLeader();
    if (res !== null) {
      currentDetach = attachLeaderEndpoints(res.http, {
        relay: res.relay,
        serverVersion: SERVER_VERSION,
        log,
      });
    }
  }
});

await election.start();

const mcp = new Server(
  { name: SERVER_NAME, version: SERVER_VERSION },
  { capabilities: { tools: {} } },
);

mcp.setRequestHandler(ListToolsRequestSchema, () => ({
  tools: [
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
    setFillsToolDefinition,
    setTextToolDefinition,
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
  ],
}));

/** Write tools get a server-generated requestId (stable across dispatch retries) so the plugin can
 * dedupe side-effects. Reads don't need it. */
const WRITE_TOOLS = new Set<string>([
  SET_FILLS_TOOL_NAME,
  SET_TEXT_TOOL_NAME,
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
]);

mcp.setRequestHandler(CallToolRequestSchema, async request => {
  const { name, arguments: args } = request.params;
  if (name === 'ping') {
    const result = await handlePing({ node, follower, serverVersion: SERVER_VERSION, log });
    return { content: [{ type: 'text' as const, text: formatPingResult(result) }] };
  }
  if (name === SAVE_SCREENSHOTS_TOOL_NAME) {
    const result = await handleSaveScreenshots(
      (tool, a) => dispatchTool({ node, follower, log }, tool, a),
      args,
    );
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
  }
  if (name === GET_SCREENSHOT_TOOL_NAME) {
    const result = (await dispatchTool({ node, follower, log }, name, args)) as GetScreenshotResult;
    return { content: screenshotContent(result) };
  }
  // Inject a stable idempotency key for write tools before the (possibly retrying) dispatch.
  const dispatchArgs = WRITE_TOOLS.has(name)
    ? { ...(args as Record<string, unknown> | undefined), requestId: newId() }
    : args;
  const result = await dispatchTool({ node, follower, log }, name, dispatchArgs);
  return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
});

const transport = new StdioServerTransport();
await mcp.connect(transport);

log(
  `[figma-mcp-relay] server ${SERVER_VERSION} (protocol ${PROTOCOL_VERSION}) ready as ${node.role}, ` +
    (node.isLeader()
      ? `relay on :${node.getLeader()?.port ?? DEFAULT_PORT}`
      : `follower → ${node.leaderUrl}`),
);

const shutdown = async (): Promise<void> => {
  election.stop();
  await node.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
