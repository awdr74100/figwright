import { z } from 'zod';

import { ALL_TOOL_SPECS } from './registry.js';
import type { ToolSpec } from './spec.js';

/**
 * The arguments a tool actually puts on the wire to the plugin, as a schema.
 *
 * A tool's `inputSchema` is what the agent is allowed to send; it is not what the sandbox handler
 * receives. Three edits sit between them, and all three are already declared on the spec because
 * `test/plugin-contract.ts` needs the same projection to record the argument surface:
 *
 * - `serverOnlyArgs` names fields that stay on the server (`outPath`, `outDir`) — removed.
 * - `injectedArgs` names fields the server adds that appear in no schema (`binary`, `budget`,
 *   `forVision`) — added.
 * - A write additionally carries the server-generated `requestId` the plugin dedupes on, derived from
 *   `kind` at the dispatch site rather than declared per tool.
 *
 * Deriving the wire shape here rather than writing it out per tool is the point. A hand-kept
 * parallel list of plugin arguments is the mirror that goes stale silently — the failure
 * `ToolSpec.serverOnlyArgs` is documented as avoiding — and a stale mirror used for _validation_
 * fails closed: it rejects a legitimate call. One derivation, one set of rules, two consumers.
 *
 * Server-injected fields are typed `unknown` on purpose. This module owns the argument _surface_;
 * the types of those fields live at their injection sites, and restating them here would recreate
 * exactly the mirror the derivation exists to avoid.
 */
export const wireToolSchema = (spec: ToolSpec): z.ZodObject | null => {
  let serverOnly: readonly string[] = [];
  if (spec.kind === 'local') {
    // `null` (or a missing declaration) says this tool has no sandbox handler of its own and
    // borrows another tool's, so it puts nothing on the wire under its own name — the tool it
    // borrows records and validates those arguments.
    if (spec.serverOnlyArgs === null || spec.serverOnlyArgs === undefined) return null;
    serverOnly = spec.serverOnlyArgs;
  }

  // Edit the shape and build once rather than chaining `.omit`/`.extend`: those take a key mask
  // typed against the schema's literal keys, which a generic ToolSpec does not carry. The cost the
  // ToolSpec docs warn about is rebuilding a schema *per call*; this runs once, at module load.
  const shape: Record<string, z.ZodType> = { ...spec.inputSchema.shape };
  for (const key of serverOnly) delete shape[key];
  for (const arg of spec.injectedArgs ?? []) shape[arg] = z.unknown().optional();
  if (spec.kind === 'write') shape.requestId = z.unknown().optional();

  return z.object(shape);
};

/**
 * Every tool name the relay can legitimately carry, mapped to the schema its arguments must
 * satisfy.
 *
 * The key set is exactly the sandbox handler registry's — 105 entries, verified equal in both
 * directions — because both are projections of the same tool list. A name outside it is a name no
 * handler exists for.
 */
export const WIRE_TOOL_SCHEMAS: ReadonlyMap<string, z.ZodObject> = new Map(
  ALL_TOOL_SPECS.flatMap(spec => {
    const schema = wireToolSchema(spec);
    return schema === null ? [] : [[spec.name, schema] as const];
  }),
);
