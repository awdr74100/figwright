// Single source of truth for per-tool timeout budgets, shared by every layer that waits on a tool
// call. A request crosses up to three independent timers, nested outer→inner:
//
//   follower → leader RPC      (follower.ts)        ← outermost, only on multi-node
//     └─ relay → plugin request (relay.ts)
//          └─ UI → sandbox bridge (ui/bridge/sandbox.ts)  ← innermost, closest to the work
//
// If any inner timer is ≥ an outer one, the outer fires first and leaves the inner layer orphaned
// (its work keeps running, its result is later discarded) and reports a vaguer error. So each layer
// must be strictly larger than the one it wraps. We derive all three from one base budget `B` plus a
// per-layer margin, so the innermost (sandbox) always fires first with the most specific error.
//
// Raising any subset in isolation does nothing: the smallest timer along the path caps the call. In
// particular the sandbox bridge defaulted to 30s for every tool, so before this table a heavy tool
// timed out there regardless of the relay/follower budgets. This lives in @figwright/shared precisely
// so the plugin UI (which can't import the mcp package's ToolSpec) reads the same numbers.

export const DEFAULT_TOOL_BUDGET_MS = 30_000;

// Tools whose Figma-side work — large synchronous serialization, a big export payload, or a
// per-instance async walk over a large tree — routinely exceeds the default window.
export const HEAVY_TOOL_BUDGET_MS = 120_000;

// Gap added per nesting layer (relay = B + 1×, follower = B + 2×) so inner fires before outer.
export const BUDGET_LAYER_MARGIN_MS = 5_000;

const HEAVY_TOOLS: ReadonlySet<string> = new Set([
  'get_screenshot',
  'save_screenshots',
  'export_pdf',
  'get_document',
  'get_design_context',
  'scan_text_nodes',
  'scan_nodes_by_types',
]);

/** Base budget `B`: how long the Figma sandbox itself may take. Used by the UI → sandbox bridge. */
export const getToolBudget = (toolName: string): number =>
  HEAVY_TOOLS.has(toolName) ? HEAVY_TOOL_BUDGET_MS : DEFAULT_TOOL_BUDGET_MS;

/** Relay → plugin request budget = B + one margin, so the sandbox bridge (inner) fires first. */
export const getRelayBudget = (toolName: string): number =>
  getToolBudget(toolName) + BUDGET_LAYER_MARGIN_MS;

/** Follower → leader RPC budget = B + two margins, the outermost layer on the multi-node path. */
export const getFollowerBudget = (toolName: string): number =>
  getToolBudget(toolName) + 2 * BUDGET_LAYER_MARGIN_MS;
