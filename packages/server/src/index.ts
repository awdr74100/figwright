import {
  DEFAULT_PORT,
  type GetScreenshotResult,
  newId,
  PROTOCOL_VERSION,
} from '@figma-mcp-relay/shared';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';

import { dispatchTool, resolveRoutingSession } from './dispatch.js';
import { Election } from './election/election.js';
import { Follower } from './election/follower.js';
import { attachLeaderEndpoints } from './election/leader-endpoints.js';
import { Node, NodeRole } from './election/node.js';
import { PROMPTS } from './prompts/registry.js';
import { ANALYZE_PROJECT_TOOL_NAME, handleAnalyzeProject } from './tools/analyze-project.js';
import { COMPONENT_MAP_TOOL_NAME, handleComponentMap } from './tools/component-map.js';
import { GET_SCREENSHOT_TOOL_NAME, screenshotContent } from './tools/get-screenshot.js';
import { handleIconMap, ICON_MAP_TOOL_NAME } from './tools/icon-map.js';
import { formatPingResult, handlePing, pingTool } from './tools/ping.js';
import { ALL_TOOL_SPECS } from './tools/registry.js';
import { handleSaveScreenshots, SAVE_SCREENSHOTS_TOOL_NAME } from './tools/save-screenshots.js';
import { handleScanComponents, SCAN_COMPONENTS_TOOL_NAME } from './tools/scan-components.js';
import type { ToolSpec } from './tools/spec.js';
import { handleTokenMap, TOKEN_MAP_TOOL_NAME } from './tools/token-map.js';

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

const mcp = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

type ToolHandler = (args: Record<string, unknown>) => Promise<CallToolResult>;

const dispatch = (tool: string, args: unknown): Promise<unknown> =>
  dispatchTool({ node, follower, log }, tool, args);

// A session-pinned dispatcher for multi-call tools: resolve the active plugin once, then route
// every sub-call to that exact session so they can't drift across plugins if routing flips
// mid-flight. Resolving to undefined (no plugin connected) falls back to live per-call routing.
const routedDispatch = async (): Promise<typeof dispatch> => {
  const sessionId = await resolveRoutingSession({ node, follower, log });
  const opts = sessionId === undefined ? {} : { sessionId };
  return (tool, args) => dispatchTool({ node, follower, log }, tool, args, opts);
};

const textResult = (data: unknown): CallToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(data) }],
});

// Tools whose result isn't just JSON.stringify(dispatch(...)): ping reports election state, the
// server-local tools read the filesystem (some reusing dispatch), and get_screenshot returns an
// image content block. Everything else takes the generic dispatch path below.
const SPECIAL_HANDLERS: Record<string, ToolHandler> = {
  [pingTool.name]: async () => ({
    content: [
      {
        type: 'text',
        text: formatPingResult(
          await handlePing({ node, follower, serverVersion: SERVER_VERSION, log }),
        ),
      },
    ],
  }),
  [SAVE_SCREENSHOTS_TOOL_NAME]: async args =>
    textResult(await handleSaveScreenshots(dispatch, args)),
  [GET_SCREENSHOT_TOOL_NAME]: async args => ({
    content: screenshotContent(
      (await dispatch(GET_SCREENSHOT_TOOL_NAME, args)) as GetScreenshotResult,
    ),
  }),
  [ANALYZE_PROJECT_TOOL_NAME]: async args => textResult(await handleAnalyzeProject(args)),
  [SCAN_COMPONENTS_TOOL_NAME]: async args => textResult(await handleScanComponents(args)),
  [COMPONENT_MAP_TOOL_NAME]: async args =>
    textResult(await handleComponentMap(await routedDispatch(), args)),
  [TOKEN_MAP_TOOL_NAME]: async args => textResult(await handleTokenMap(dispatch, args)),
  [ICON_MAP_TOOL_NAME]: async args => textResult(await handleIconMap(await routedDispatch(), args)),
};

// Reversible writes that destroy data — surfaced via the destructiveHint annotation. Other writes
// (creates / property sets) are non-destructive; reads/locals are read-only (derived from kind).
const DESTRUCTIVE_TOOLS = new Set([
  'delete_nodes',
  'delete_page',
  'delete_style',
  'delete_variable',
  'ungroup_nodes',
]);

const annotationsFor = (spec: ToolSpec): ToolAnnotations =>
  spec.kind === 'write'
    ? { readOnlyHint: false, destructiveHint: DESTRUCTIVE_TOOLS.has(spec.name) }
    : { readOnlyHint: true };

for (const spec of ALL_TOOL_SPECS) {
  const handler: ToolHandler =
    SPECIAL_HANDLERS[spec.name] ??
    (async args => {
      // Inject a stable idempotency key for writes before the (possibly retrying) dispatch.
      const dispatchArgs = spec.kind === 'write' ? { ...args, requestId: newId() } : args;
      return textResult(await dispatch(spec.name, dispatchArgs));
    });
  // Cast: registerTool is generic per inputShape; this loop registers heterogeneous specs uniformly.
  mcp.registerTool(
    spec.name,
    {
      description: spec.description,
      inputSchema: spec.inputShape,
      annotations: annotationsFor(spec),
    },
    handler as never,
  );
}

for (const prompt of PROMPTS) {
  mcp.registerPrompt(
    prompt.definition.name,
    { description: prompt.definition.description ?? '', argsSchema: prompt.argsSchema },
    ((args: Record<string, string>) => prompt.build(args)) as never,
  );
}

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
