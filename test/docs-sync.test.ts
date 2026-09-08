import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ALL_TOOL_SPECS } from '../packages/mcp/src/tools/registry.js';

// Docs-sync guard: the tool count is prose in the two user-facing READMEs (the GitHub front page and
// the npm package page) while the authority is ALL_TOOL_SPECS.length — and the npm one has already
// drifted once (advertised 96 while the server shipped 101). Lock every "N tools" / "N MCP tools"
// claim in them to the registry, bold or not. Requiring at least one match per file keeps the guard
// itself honest: a reworded README that no longer matches the pattern fails loudly instead of
// silently un-guarding the number.
//
// Only these two files, because only these two have a reason to state a number: there it is a
// selling point a reader actually wants. Everywhere else the count is incidental, so the fix for
// drift is to stop stating it rather than to widen this list — AGENTS.md, the SDK-audit skill and
// the JSON-schema test each said a number once, drifted, and now describe the set instead
// ("every tool"). Guard what earns a number; reword what doesn't.

const COUNTED_DOC_PATHS = ['README.md', 'packages/mcp/README.md'];
const TOOL_COUNT_CLAIM = /\*{0,2}(\d+)\*{0,2} (?:MCP )?tools\b/g;

describe('README tool counts', () => {
  it.each(COUNTED_DOC_PATHS)('%s advertises exactly ALL_TOOL_SPECS.length tools', path => {
    const body = readFileSync(join(import.meta.dirname, '..', path), 'utf8');
    const claims = [...body.matchAll(TOOL_COUNT_CLAIM)].map(m => Number(m[1]));
    expect(
      claims.length,
      `${path}: no "N tools" claim found — update TOOL_COUNT_CLAIM`,
    ).toBeGreaterThan(0);
    expect(claims).toEqual(claims.map(() => ALL_TOOL_SPECS.length));
  });
});
