import type { ZodRawShape } from 'zod';

// A tool's input schema as a single source of truth: a Zod raw shape. index.ts registers each spec
// with McpServer.registerTool, which consumes `inputShape` directly and auto-generates the advertised
// JSON Schema. `.describe()` on a field becomes its JSON Schema description.

export type ToolKind = 'read' | 'write' | 'local';

export interface ToolSpec {
  name: string;
  description: string;
  /** Zod raw shape (e.g. `{ nodeId: z.string() }`); `{}` for a no-argument tool. */
  inputShape: ZodRawShape;
  kind: ToolKind;
  /**
   * Marks a write that irreversibly destroys user data (a delete, ungrouping, clearing reactions,
   * severing an instance from its component) — drives the MCP `destructiveHint` annotation. Lives
   * on the spec so the flag can't drift from the tool it describes; a registry test asserts every
   * `delete_*` tool carries it. Omitted = non-destructive (creates / property sets).
   */
  destructive?: true;
}
