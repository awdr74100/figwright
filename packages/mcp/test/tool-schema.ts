import type { Tool } from '@modelcontextprotocol/server';
import { z } from 'zod';

import type { ToolSpec } from '../src/tools/spec.js';

/**
 * Derive the JSON-Schema `Tool` definition a spec advertises — independently of the SDK.
 *
 * Per-tool tests use it to assert the advertised contract (required fields, property types) a
 * client sees, without that derivation living in src. `e2e/mcp-wire.test.ts` then checks this
 * derivation against what a real MCP client receives over stdio, which is what makes the
 * independence worth having: if an SDK release changes schema generation, the two sides disagree
 * and the wire gate fails. Keep the conversion options matching what the SDK asks Zod for (`io:
 * 'input'`, 2020-12) or that comparison reports a difference that isn't real.
 */
export const toToolDefinition = (spec: ToolSpec): Tool => ({
  name: spec.name,
  description: spec.description,
  inputSchema: z.toJSONSchema(spec.inputSchema, {
    io: 'input',
    target: 'draft-2020-12',
  }) as Tool['inputSchema'],
});
