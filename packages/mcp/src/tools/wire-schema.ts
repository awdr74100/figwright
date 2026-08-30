import { ErrorCode } from '@figwright/shared';
import { z } from 'zod';

import { BATCH_TOOL_NAME } from './batch.js';
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

/** Issues named in a rejection: enough to fix the call, bounded so a bad payload can't set the size. */
const MAX_REPORTED_ISSUES = 3;

const summarize = (issues: readonly z.core.$ZodIssue[]): string => {
  const named = issues
    .slice(0, MAX_REPORTED_ISSUES)
    .map(issue => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
  const rest = issues.length - MAX_REPORTED_ISSUES;
  return `${named}${rest > 0 ? ` (+${rest} more)` : ''}`;
};

export interface WireRejection {
  code: ErrorCode;
  message: string;
}

/**
 * Check a batch's ops against the schema of the tool each one names.
 *
 * `batch` is the one tool whose own schema cannot describe what it does: `ops[].params` is a
 * free-form record, because it is the union of thirty other tools' arguments. Everything downstream
 * takes that at face value — the sandbox's batch handler hands `op.params` to the raw write handler
 * verbatim, and those read fields off a loose cast — so an op's arguments were the one payload that
 * reached `figma.*` unchecked even on the in-process path, where the SDK validates every other
 * tool's arguments against this very schema before dispatch.
 *
 * Being wrong here is more expensive than elsewhere. A batch is atomic: an op that fails during
 * apply unwinds the ops already applied, and that unwind is itself allowed to fail — the handler
 * has a branch that reports "undo(s) FAILED — document may be partially changed". Arguments that
 * could never have worked are worth refusing before the first op touches the document, so that path
 * is never entered for a preventable reason.
 *
 * What this deliberately leaves to the plugin: _which_ tools may be batched. That allowlist is the
 * `INVERSES` map — membership means an op can be rolled back — and it is the sandbox's own
 * invariant, derived from nothing on this side. Mirroring it here would be a hand-kept copy of a
 * list this module cannot see, which is the failure the rest of this file exists to avoid; the
 * plugin already refuses a non-batchable op by name, with a better message than a mirror could
 * give. This only answers "could this op's arguments ever have worked".
 *
 * Returns null when there is nothing to object to, including for a shape this cannot read — the
 * batch schema itself is what rejects a malformed `ops`, and it runs first at both call sites.
 */
export const checkBatchOps = (args: unknown): WireRejection | null => {
  const ops = (args as { ops?: unknown } | null)?.ops;
  if (!Array.isArray(ops)) return null;

  for (const [index, op] of ops.entries()) {
    const tool = (op as { tool?: unknown } | null)?.tool;
    if (typeof tool !== 'string') return null;

    const schema = WIRE_TOOL_SCHEMAS.get(tool);
    if (schema === undefined) {
      return {
        code: ErrorCode.MethodNotFound,
        message: `batch ops[${index}]: '${tool}' has no sandbox handler`,
      };
    }

    // `?? {}` matches what the sandbox's own parseOps does with an omitted params.
    const parsed = schema.safeParse((op as { params?: unknown }).params ?? {});
    if (!parsed.success) {
      return {
        code: ErrorCode.InvalidParams,
        message: `batch ops[${index}] ('${tool}'): ${summarize(parsed.error.issues)}`,
      };
    }
  }

  return null;
};

/**
 * Check one tool call — the arguments against the tool's wire schema, and a batch's ops against
 * theirs. The single description of "would the plugin have been able to use this", so the leader's
 * `/rpc` boundary and the in-process batch path cannot come to different conclusions.
 */
export const checkWireCall = (toolName: string, args: unknown): WireRejection | null => {
  const schema = WIRE_TOOL_SCHEMAS.get(toolName);
  if (schema === undefined) {
    return { code: ErrorCode.MethodNotFound, message: `no tool named '${toolName}'` };
  }

  // An omitted `args` is how a no-argument tool is called, and it is what the plugin sees as an
  // empty parameter object — so it is checked as one rather than waved through.
  const parsed = schema.safeParse(args ?? {});
  if (!parsed.success) {
    return {
      code: ErrorCode.InvalidParams,
      message: `invalid arguments for '${toolName}' — ${summarize(parsed.error.issues)}`,
    };
  }

  return toolName === BATCH_TOOL_NAME ? checkBatchOps(args) : null;
};
