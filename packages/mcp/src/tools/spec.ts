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
}
