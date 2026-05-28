import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z, type ZodRawShape } from 'zod';

// A tool's input schema as a single source of truth: a Zod raw shape. McpServer.registerTool consumes
// `inputShape` directly (and auto-generates the advertised JSON Schema); during the migration, the
// legacy ListTools path derives the JSON Schema from the same shape via specToToolDefinition, so the
// description and constraints are written exactly once. `.describe()` on a field becomes its JSON
// Schema description.

export type ToolKind = 'read' | 'write' | 'local';

export interface ToolSpec {
  name: string;
  description: string;
  /** Zod raw shape (e.g. `{ nodeId: z.string() }`); `{}` for a no-argument tool. */
  inputShape: ZodRawShape;
  kind: ToolKind;
}

/**
 * Derive the legacy MCP `Tool` definition (JSON Schema `inputSchema`) from a spec, for the
 * pre-cutover ListTools path. Removed in Phase 2 once McpServer generates the schema itself.
 */
export const specToToolDefinition = (spec: ToolSpec): Tool => ({
  name: spec.name,
  description: spec.description,
  inputSchema: z.toJSONSchema(z.object(spec.inputShape)) as Tool['inputSchema'],
});
