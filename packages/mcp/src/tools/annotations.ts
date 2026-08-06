import type { ToolAnnotations } from '@modelcontextprotocol/server';

import type { ToolSpec } from './spec.js';

/**
 * The MCP annotations a spec advertises — derived from the spec, never hand-kept: `kind` drives
 * readOnlyHint and the spec's own `destructive` flag drives destructiveHint (a registry test
 * asserts every delete_* carries it, so a new destructive tool can't ship silently marked
 * "non-destructive").
 *
 * Lives here rather than inline in index.ts so the wire gate can assert what a client actually
 * receives against this same function, instead of restating the rule and drifting from it.
 */
export const annotationsFor = (spec: ToolSpec): ToolAnnotations =>
  spec.kind === 'write'
    ? { readOnlyHint: false, destructiveHint: spec.destructive === true }
    : { readOnlyHint: true };
