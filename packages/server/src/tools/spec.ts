import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z, type ZodRawShape } from 'zod';

// A tool's input schema as a single source of truth: a Zod raw shape. index.ts registers each spec
// with McpServer.registerTool, which consumes `inputShape` directly and auto-generates the advertised
// JSON Schema — so the live path never needs specToToolDefinition. `.describe()` on a field becomes
// its JSON Schema description.

export type ToolKind = 'read' | 'write' | 'local';

export interface ToolSpec {
  name: string;
  description: string;
  /** Zod raw shape (e.g. `{ nodeId: z.string() }`); `{}` for a no-argument tool. */
  inputShape: ZodRawShape;
  kind: ToolKind;
}

/**
 * Derive the MCP `Tool` definition (JSON Schema `inputSchema`) a spec advertises — the same JSON
 * McpServer generates internally from `inputShape`. No longer on the live request path; retained so
 * unit tests can assert the advertised schema each tool produces from its Zod shape.
 */
export const specToToolDefinition = (spec: ToolSpec): Tool => ({
  name: spec.name,
  description: spec.description,
  inputSchema: z.toJSONSchema(z.object(spec.inputShape)) as Tool['inputSchema'],
});
