import type { z } from 'zod';

// A tool's input schema as a single source of truth: a Zod object, which is what the MCP SDK takes
// (`registerTool` wants a Standard Schema object; the bare-shape overload it also accepts is
// deprecated). `.describe()` on a field becomes its JSON Schema description.
//
// Storing the built object rather than a raw shape is what lets every consumer share one instance:
// registration, the handlers that re-parse their own arguments, and the test-only derivation in
// `test/tool-schema.ts`. Rebuilding it per call — which the raw shape forced on eleven handlers —
// measured ~120x the cost of parsing against a prebuilt one.

export type ToolKind = 'read' | 'write' | 'local';

export interface ToolSpec {
  name: string;
  description: string;
  /**
   * Arguments as a Zod object (e.g. `z.object({ nodeId: z.string() })`); `z.object({})` when the
   * tool takes none.
   */
  inputSchema: z.ZodObject;
  kind: ToolKind;
  /**
   * Marks a write that irreversibly destroys user data (a delete, ungrouping, clearing reactions,
   * severing an instance from its component) — drives the MCP `destructiveHint` annotation. Lives
   * on the spec so the flag can't drift from the tool it describes; a registry test asserts every
   * `delete_*` tool carries it. Omitted = non-destructive (creates / property sets).
   */
  destructive?: true;
  /**
   * Arguments the server adds to the dispatch that are not in `inputSchema` — the agent never sends
   * them and no JSON Schema mentions them, so they are invisible to every other check here. They
   * are still arguments an older sandbox handler can silently drop, and the two that exist do real
   * work (`forVision` caps a raster to what fits a model's context; `budget` arms the node-count
   * bail), so `test/plugin-contract.test.ts` has to see them. Declared on the spec for the same
   * reason `destructive` is — it cannot drift from the tool it describes, and a test asserts the
   * declarations match the injection sites in `index.ts`.
   *
   * `requestId` is not listed: it is derived from `kind === 'write'` at the dispatch site.
   */
  injectedArgs?: readonly string[];
  /**
   * Required on every `kind: 'local'` spec — the plugin-facing half of a tool whose `inputSchema`
   * is not it. A read/write tool dispatches its own schema verbatim, so the schema _is_ the
   * contract; a local tool's handler builds the plugin payload by hand, and the schema also carries
   * server-only fields (`outPath`, `outDir`) that must never be recorded as plugin arguments.
   *
   * An array names those server-only fields and opts the tool into the recorded contract: its
   * plugin-facing surface is `inputSchema − serverOnlyArgs + injectedArgs`. `null` says the tool
   * has no plugin handler of its own and borrows another tool's (save_screenshots → get_screenshot,
   * component_map → get_design_context), so its arguments are recorded under the tool it borrows.
   *
   * Declared as the _exclusions_ rather than the plugin argument list on purpose. The list would be
   * a hand-kept mirror of the schema that goes stale silently — the failure this repo keeps
   * relearning. The exclusions are few and change far less often, and forgetting one fails loud: an
   * unlisted server-only field shows up as a new plugin argument in the contract diff, which is
   * noisy and wrong rather than quiet and wrong.
   */
  serverOnlyArgs?: readonly string[] | null;
}
