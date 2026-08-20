import { DEFAULT_PORT, type GetScreenshotResult, newId, PROTOCOL_VERSION } from '@figwright/shared';
import { McpServer } from '@modelcontextprotocol/server';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';

import pkg from '../package.json' with { type: 'json' };
import { BUILD_ID } from './build-id.js';
import { dispatchTool, resolveRoutingSession } from './dispatch.js';
import { Election } from './election/election.js';
import { Follower } from './election/follower.js';
import { attachLeaderEndpoints } from './election/leader-endpoints.js';
import { writeLeaderLock } from './election/leader-lock.js';
import { Node, NodeRole } from './election/node.js';
import { SERVER_INSTRUCTIONS } from './instructions.js';
import { wireShutdown } from './lifecycle.js';
import { normalizeIdArgs } from './node-id.js';
import { PROMPTS } from './prompts/registry.js';
import { ANALYZE_PROJECT_TOOL_NAME, handleAnalyzeProject } from './tools/analyze-project.js';
import { annotationsFor } from './tools/annotations.js';
import { COMPONENT_MAP_TOOL_NAME, handleComponentMap } from './tools/component-map.js';
import { handleDesignContext } from './tools/design-context-guard.js';
import { DESIGN_DIFF_TOOL_NAME, handleDesignDiff } from './tools/design-diff.js';
import { EXPORT_PDF_TOOL_NAME, handleExportPdf } from './tools/export-pdf.js';
import { EXPORT_VIDEO_TOOL_NAME, handleExportVideo } from './tools/export-video.js';
import { GET_DESIGN_CONTEXT_TOOL_NAME } from './tools/get-design-context.js';
import { GET_SCREENSHOT_TOOL_NAME, screenshotContent } from './tools/get-screenshot.js';
import { handleIconMap, ICON_MAP_TOOL_NAME } from './tools/icon-map.js';
import { formatPingResult, handlePing, pingTool } from './tools/ping.js';
import { ALL_TOOL_SPECS } from './tools/registry.js';
import { handleSaveImageFills, SAVE_IMAGE_FILLS_TOOL_NAME } from './tools/save-image-fills.js';
import { handleSaveScreenshots, SAVE_SCREENSHOTS_TOOL_NAME } from './tools/save-screenshots.js';
import { handleScanComponents, SCAN_COMPONENTS_TOOL_NAME } from './tools/scan-components.js';
import { captureSkew, withSkewNotice } from './tools/skew-notice.js';
import { handleTokenMap, TOKEN_MAP_TOOL_NAME } from './tools/token-map.js';

const SERVER_NAME = 'figwright';
const SERVER_VERSION = pkg.version;

const log = (msg: string): void => {
  process.stderr.write(`${msg}\n`);
};

// FIGWRIGHT_PORT is a test/debug seam (the process-lifecycle e2e spawns real servers on a random
// port). The plugin always connects to DEFAULT_PORT, so overriding this in normal use just makes
// the server unreachable — hence undocumented.
const envPort = Number(process.env.FIGWRIGHT_PORT);
const PORT = Number.isInteger(envPort) && envPort > 0 && envPort < 65_536 ? envPort : DEFAULT_PORT;

const node = new Node({ serverVersion: SERVER_VERSION, port: PORT, log });
const follower = new Follower({ leaderUrl: node.leaderUrl, log });
const election = new Election({ node, follower, buildId: BUILD_ID, log });

let currentDetach: (() => void) | null = null;
node.onRoleChange(role => {
  if (currentDetach !== null) {
    currentDetach();
    currentDetach = null;
  }
  if (role === NodeRole.Leader) {
    const res = node.getLeader();
    if (res !== null) {
      // Leave a note naming this process as the port's owner. It is read by exactly one caller: a
      // node that finds the port bound by something that won't answer /ping, which is the single
      // failure the election cannot resolve by waiting (see election/leader-lock.ts). Best-effort —
      // a server that can't write it still leads.
      writeLeaderLock({ port: res.port, buildId: BUILD_ID, serverVersion: SERVER_VERSION });
      currentDetach = attachLeaderEndpoints(res.http, {
        relay: res.relay,
        serverVersion: SERVER_VERSION,
        buildId: BUILD_ID,
        // Newest build wins: a follower on a newer build asks us to step down; the port frees for
        // it within ms and the plugin reconnects to the new leader on its next retry (~250ms).
        onAbdicate: () => election.yieldLeadership(),
        log,
      });
    }
  }
});

await election.start();

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
          await handlePing({
            node,
            follower,
            serverVersion: SERVER_VERSION,
            buildId: BUILD_ID,
            log,
          }),
        ),
      },
    ],
  }),
  [SAVE_SCREENSHOTS_TOOL_NAME]: async args =>
    textResult(await handleSaveScreenshots(dispatch, args)),
  [SAVE_IMAGE_FILLS_TOOL_NAME]: async args =>
    textResult(await handleSaveImageFills(dispatch, args)),
  [EXPORT_PDF_TOOL_NAME]: async args => textResult(await handleExportPdf(dispatch, args)),
  [EXPORT_VIDEO_TOOL_NAME]: async args => textResult(await handleExportVideo(dispatch, args)),
  // forVision marks this as the path whose rasters are inlined into the model's context, so the
  // sandbox caps an oversized scale to what a vision model can actually resolve. save_screenshots
  // dispatches the same tool without it — those bytes go to disk and keep the caller's scale.
  [GET_SCREENSHOT_TOOL_NAME]: async args => ({
    content: screenshotContent(
      (await dispatch(GET_SCREENSHOT_TOOL_NAME, {
        ...args,
        forVision: true,
      })) as GetScreenshotResult,
    ),
  }),
  [ANALYZE_PROJECT_TOOL_NAME]: async args => textResult(await handleAnalyzeProject(args)),
  [SCAN_COMPONENTS_TOOL_NAME]: async args => textResult(await handleScanComponents(args)),
  [COMPONENT_MAP_TOOL_NAME]: async args =>
    textResult(await handleComponentMap(await routedDispatch(), args)),
  [TOKEN_MAP_TOOL_NAME]: async args => textResult(await handleTokenMap(dispatch, args)),
  [ICON_MAP_TOOL_NAME]: async args => textResult(await handleIconMap(await routedDispatch(), args)),
  [DESIGN_DIFF_TOOL_NAME]: async args => textResult(await handleDesignDiff(dispatch, args)),
  // The guarded public path: arms the plugin's node-count bail (budget: true) and applies the
  // payload-size net + below-full note. Internal dispatches (design_diff, component/icon map) call
  // the tool directly and stay raw.
  [GET_DESIGN_CONTEXT_TOOL_NAME]: async args =>
    textResult(await handleDesignContext(dispatch, args)),
};

// serveStdio owns the era decision for the connection: it reads the opening exchange, pins ONE
// instance from this factory for the connection's lifetime, and passes everything after straight
// through. A 2025-era client is served exactly as `new StdioServerTransport()` + `connect()` served
// it; a 2026-07-28 client negotiates the modern revision instead — which a hand-wired transport
// can't do. On stdio there is exactly one connection per process, so this runs once.
const createMcpServer = (): McpServer => {
  const mcp = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: SERVER_INSTRUCTIONS },
  );

  for (const spec of ALL_TOOL_SPECS) {
    const run: ToolHandler =
      SPECIAL_HANDLERS[spec.name] ??
      (async args => {
        // Inject a stable idempotency key for writes before the (possibly retrying) dispatch.
        const dispatchArgs = spec.kind === 'write' ? { ...args, requestId: newId() } : args;
        return textResult(await dispatch(spec.name, dispatchArgs));
      });
    // Normalize id args (a pasted Figma URL or dash-form node id → canonical colon id) once here, so
    // every tool — generic or special-cased — accepts them without per-handler conversion.
    // An older plugin drops arguments it predates and still answers `{ ok: true }`, so the result
    // cannot be trusted on its face and nothing in it says so. Saying it here, on every affected
    // call, is what replaces the refusal this used to be: the agent is told before it reports
    // success to the user.
    const handler: ToolHandler = async args =>
      captureSkew(
        () => run(normalizeIdArgs(args)),
        (result, notice) => withSkewNotice(result, notice),
      );
    // The spec's own Zod object goes straight through: it is already the Standard Schema object the
    // SDK wants. Registering heterogeneous specs through one loop needed a handler cast under v1;
    // v2's typing accepts ToolHandler directly, so the result stays checked against CallToolResult.
    mcp.registerTool(
      spec.name,
      {
        description: spec.description,
        inputSchema: spec.inputSchema,
        annotations: annotationsFor(spec),
      },
      handler,
    );
  }

  for (const prompt of PROMPTS) {
    mcp.registerPrompt(
      prompt.definition.name,
      {
        description: prompt.definition.description ?? '',
        argsSchema: prompt.argsSchema,
      },
      args => prompt.build(args),
    );
  }

  return mcp;
};

/**
 * A stdio transport that reports its own death.
 *
 * The SDK closes this transport when a read fails fatally — reachably today when an inbound message
 * exceeds the 10MB read buffer, which `import_image`'s base64 `data` can do. Closing only detaches
 * the stdin listeners and pauses the stream: it emits neither 'end' nor 'close', so none of
 * wireShutdown's triggers fire. The process then survives as a leader that can no longer hear its
 * client while still holding the relay port — a follower behind it can never take over, and nothing
 * is logged. Reporting the close routes that silent dead end into the ordinary shutdown path, after
 * which the port frees and a follower is promoted on its next tick.
 *
 * Overriding close() rather than onclose is deliberate: whoever owns the connection assigns onclose
 * for its own bookkeeping, so it is not ours to take.
 */
class SelfReportingStdioTransport extends StdioServerTransport {
  constructor(private readonly onClosed: () => void) {
    super();
  }

  override async close(): Promise<void> {
    await super.close();
    this.onClosed();
  }
}

// Deferred because the trigger only exists once wireShutdown has run, and that needs the transport.
let triggerShutdown = (): void => {};
const stdio = serveStdio(createMcpServer, {
  // serveStdio would otherwise construct its own transport, and we need one that reports its death.
  transport: new SelfReportingStdioTransport(() => {
    triggerShutdown();
  }),
  // Unset, serveStdio discards transport errors outright, so the one message naming the cause
  // (e.g. "ReadBuffer exceeded maximum size of 10485760 bytes") never reaches the user's stderr.
  onerror: (error: Error): void => {
    log(`[figwright] stdio transport error: ${error.message}`);
  },
});

const roleDetail = node.isLeader()
  ? `relay on :${node.getLeader()?.port ?? PORT}`
  : node.isConflicted()
    ? `:${PORT} held by an unresponsive owner — contending for it`
    : `follower → ${node.leaderUrl}`;
log(
  `[figwright] server ${SERVER_VERSION} (protocol ${PROTOCOL_VERSION}) ready as ${node.role}, ${roleDetail}`,
);

const shutdown = async (): Promise<void> => {
  // serveStdio owns the transport it started, so it has to be the one to close it — closing the
  // pinned instance and detaching from stdin. Its own errors must not skip the relay teardown
  // below: the relay port is the resource a zombie would hold, and stdio is already going away.
  await stdio.close().catch(() => {});
  election.stop();
  await node.stop();
  process.exit(0);
};
// Exit on SIGINT/SIGTERM, on stdin EOF, and on the transport dying under us. stdin closes when the
// client that spawned us goes away (including a crash that sends no signal); without this the
// process would linger holding the relay port as a stale "zombie" leader serving an old build.
// wireShutdown runs shutdown at most once, so the transport trigger is safe to fire during our own
// shutdown — which closes that same transport. hardExit is the backstop for the graceful path
// itself stalling (e.g. a close waiting on connections that never drain) — exit code 1 marks the
// forced, non-clean variant.
triggerShutdown = wireShutdown({
  proc: process,
  stdin: process.stdin,
  shutdown,
  hardExit: () => {
    log('[figwright] graceful shutdown stalled — forcing exit');
    process.exit(1);
  },
});
