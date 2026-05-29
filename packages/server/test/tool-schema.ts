import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import type { ToolSpec } from '../src/tools/spec.js';

/**
 * Derive the JSON-Schema `Tool` definition a spec advertises — the same JSON McpServer generates
 * from `inputShape` at registerTool time. Test-only: lets per-tool tests assert the advertised
 * contract (required fields, property types) a client sees, without that derivation living in src.
 */
export const toToolDefinition = (spec: ToolSpec): Tool => ({
  name: spec.name,
  description: spec.description,
  inputSchema: z.toJSONSchema(z.object(spec.inputShape)) as Tool['inputSchema'],
});
