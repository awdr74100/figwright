import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// Whether a project's styling system generates utility classes decides two things a caller acts on:
// which literal to emit for a token (`primary-500` vs `var(--primary-500)`), and whether a Figma
// variable hitting a built-in scale is a usable utility or a gap. Several surfaces need that answer
// — the token join, the design-context value annotation, the icon join — and when they disagree the
// same project gets contradictory instructions in one session.
//
// isUtilityFirst() exists to be the single place that decides it. This guards that: adding UnoCSS
// migrated token_map and the design-context annotation but left icon_map on its own
// `system === 'tailwind'` comparison, so token_map handed codegen `primary-500` while icon_map told
// it to write `var(--token)`, which on that project does not exist. Nothing caught it, because the
// icon join's own tests pass the flag in directly and there is no test of the tool that derives it.
//
// A structural check rather than a per-tool test, for the same reason `plugin-contract.test.ts` is
// structural: it cannot decide whether a given comparison is right, but it makes skipping the
// shared predicate impossible to do quietly.

const SRC = join(import.meta.dirname, '..', '..', 'src');

/** Every .ts file under src, recursively. */
const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  });

// Any comparison of a styling system to a utility framework, however it reaches the value. Matching
// on `styling.system` alone left `const { system } = profile.styling` free to bypass the whole
// guard, which is the shape someone reaches for precisely when they are writing several of these.
const DIRECT_COMPARISON = /\bsystem\s*===\s*['"](tailwind|unocss)['"]/;

/**
 * Files allowed to compare the literal, each with the reason it is asking a different question from
 * "does this project generate utilities". An entry here is a claim someone had to write down; that
 * is the whole point, since the two questions look identical at the call site.
 */
const ALLOWED: ReadonlyMap<string, string> = new Map([
  ['profile/profile.ts', 'declares isUtilityFirst — the predicate every other file should call'],
  [
    'tokens/load.ts',
    'picks which config vocabulary to parse (Tailwind keys vs UnoCSS keys), which is not the same ' +
      'question as whether the project generates utility classes — a project can be one and read ' +
      'a config written in the other, which is exactly what the tokenSource override allows',
  ],
]);

describe('utility-first is decided in one place', () => {
  it('no unexplained source file compares styling.system to a utility framework', () => {
    const offenders = sourceFiles(SRC)
      .filter(path => DIRECT_COMPARISON.test(readFileSync(path, 'utf8')))
      .map(path => path.slice(SRC.length + 1).replaceAll('\\', '/'))
      .filter(rel => !ALLOWED.has(rel));

    // If this fails: call isUtilityFirst(profile.styling.system) instead. If the file genuinely
    // needs to tell Tailwind from UnoCSS rather than ask whether utilities exist, add it to ALLOWED
    // with the reason — and say why the distinction matters there.
    expect(offenders).toEqual([]);
  });

  it('every allowlist entry still compares the literal, so stale exemptions are removed', () => {
    const stale = [...ALLOWED.keys()].filter(
      rel => !DIRECT_COMPARISON.test(readFileSync(join(SRC, rel), 'utf8')),
    );
    expect(stale).toEqual([]);
  });
});
