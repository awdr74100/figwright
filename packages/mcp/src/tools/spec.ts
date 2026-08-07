import type { ZodRawShape } from 'zod';

// A tool's input schema as a single source of truth: a Zod raw shape. index.ts wraps it with
// `z.object()` before handing it to McpServer.registerTool — the SDK takes Standard Schema objects,
// and the bare-shape overload it still accepts is deprecated. `.describe()` on a field becomes its
// JSON Schema description.
//
// The shape stays raw here because that is all any tool needs: every input is a flat object of
// independent fields. The four tools with a cross-field rule (`import_image` data-or-url and
// friends) enforce it in the sandbox, which a `z.object().refine()` could not improve on — Zod drops
// refinements from the generated JSON Schema, so the model would still learn the rule only from the
// description and the error, exactly as it does today.

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
