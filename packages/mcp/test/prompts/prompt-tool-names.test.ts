import { describe, expect, it } from 'vitest';

import { PROMPTS } from '../../src/prompts/registry.js';
import { ALL_TOOL_SPECS } from '../../src/tools/registry.js';

// Guard against prompt drift: the distilled prompts teach workflows by tool name, and a renamed or
// removed tool would otherwise keep being taught as a dead name (the prompts are the only guidance
// surface non-skill MCP clients get). Every snake_case token in a prompt's text must be a real
// registry tool or an explicitly allowlisted non-tool term. This can't catch a NEW tool missing
// from a prompt — that stays a release-checklist item.

const TOOL_NAMES = new Set(ALL_TOOL_SPECS.map(spec => spec.name));

// snake_case words that are intentionally not tool names (schema fields, protocol terms).
const ALLOWLIST = new Set<string>([]);

// Multi-segment lowercase snake_case only, so ordinary prose never matches.
const SNAKE_CASE = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g;

describe('prompt tool-name guard', () => {
  for (const prompt of PROMPTS) {
    it(`${prompt.definition.name}: every snake_case token is a registry tool or allowlisted`, () => {
      const result = prompt.build({});
      const text = result.messages
        .map(m => (m.content.type === 'text' ? m.content.text : ''))
        .join('\n');
      expect(text.length).toBeGreaterThan(0);
      const tokens = [...new Set([...text.matchAll(SNAKE_CASE)].map(m => m[0]))];
      // A guided prompt always names tools; zero matches would mean the extraction silently broke.
      expect(tokens.length).toBeGreaterThan(0);
      const offenders = tokens.filter(t => !TOOL_NAMES.has(t) && !ALLOWLIST.has(t));
      expect(offenders).toEqual([]);
    });
  }
});
