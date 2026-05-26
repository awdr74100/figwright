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
import { TOOL_DEFINITIONS, WRITE_TOOL_NAMES } from './tools/registry.js';
import { ANALYZE_PROJECT_TOOL_NAME, handleAnalyzeProject } from './tools/analyze-project.js';
import { COMPONENT_MAP_TOOL_NAME, handleComponentMap } from './tools/component-map.js';
import { handleScanComponents, SCAN_COMPONENTS_TOOL_NAME } from './tools/scan-components.js';
import { GET_SCREENSHOT_TOOL_NAME, screenshotContent } from './tools/get-screenshot.js';
import { formatPingResult, handlePing } from './tools/ping.js';
import { handleSaveScreenshots, SAVE_SCREENSHOTS_TOOL_NAME } from './tools/save-screenshots.js';

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

mcp.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [...TOOL_DEFINITIONS] }));

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
  if (name === ANALYZE_PROJECT_TOOL_NAME) {
    const result = await handleAnalyzeProject(args);
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
  }
  if (name === SCAN_COMPONENTS_TOOL_NAME) {
    const result = await handleScanComponents(args);
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
  }
  if (name === COMPONENT_MAP_TOOL_NAME) {
    const result = await handleComponentMap(
      (tool, a) => dispatchTool({ node, follower, log }, tool, a),
      args,
    );
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
  }
  // Inject a stable idempotency key for write tools before the (possibly retrying) dispatch.
  const dispatchArgs = WRITE_TOOL_NAMES.has(name)
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
