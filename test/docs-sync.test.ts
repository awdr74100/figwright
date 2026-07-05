import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ALL_TOOL_SPECS } from '../packages/mcp/src/tools/registry.js';

// Docs-sync guard: the tool count is prose in two user-facing READMEs (the GitHub front page and
// the npm package page) while the authority is ALL_TOOL_SPECS.length — and the npm one has already
// drifted once (advertised 96 while the server shipped 101). Lock every bolded "**N tools**" /
// "**N MCP tools**" claim to the registry. Requiring at least one match per file keeps the guard
// itself honest: a reworded README that no longer matches the pattern fails loudly instead of
// silently un-guarding the number.

const README_PATHS = ['README.md', 'packages/mcp/README.md'];
const TOOL_COUNT_CLAIM = /\*\*(\d+)(?: MCP)? tools\*\*/g;

describe('README tool counts', () => {
  it.each(README_PATHS)('%s advertises exactly ALL_TOOL_SPECS.length tools', path => {
    const body = readFileSync(join(import.meta.dirname, '..', path), 'utf8');
    const claims = [...body.matchAll(TOOL_COUNT_CLAIM)].map(m => Number(m[1]));
    expect(
      claims.length,
      `${path}: no "**N tools**" claim found — update TOOL_COUNT_CLAIM`,
    ).toBeGreaterThan(0);
    expect(claims).toEqual(claims.map(() => ALL_TOOL_SPECS.length));
  });
});
