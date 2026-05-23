import { DEFAULT_PORT, type GetScreenshotResult, PROTOCOL_VERSION } from '@figma-mcp-relay/shared';
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
  ],
}));

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
  const result = await dispatchTool({ node, follower, log }, name, args);
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
