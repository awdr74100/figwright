import { describe, expect, it, vi } from 'vitest';

import { createFindReplaceTextHandler } from '../../src/handlers/find-replace-text.js';
import { createSetTextHandler } from '../../src/handlers/set-text.js';
import { makeText } from './text-fake.js';

// Differential tests for in-place text editing against what assigning `characters` did before.
// The text must come out identical; the styling may only be kept where the old way discarded it,
// never invented. Random cases use a two-letter alphabet so shared prefixes, suffixes and repeated
// matches — the cases most likely to go wrong — come up constantly.

const SEED = 20_261_001;
const CASES = 3_000;

/** Mulberry32: a small seeded PRNG, so every run of this test sees the same cases. */
const prng = (seed: number) => {
  let a = seed;
  return (): number => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
};

const word = (rand: () => number, max: number): string => {
  let s = '';
  const n = Math.floor(rand() * (max + 1));
  for (let i = 0; i < n; i += 1) s += 'ab '[Math.floor(rand() * 3)];
  return s;
};

const randomRuns = (rand: () => number): [string, string][] => {
  const runs: [string, string][] = [];
  const count = 1 + Math.floor(rand() * 4);
  for (let i = 0; i < count; i += 1) {
    const text = word(rand, 4) || 'a';
    runs.push([text, `s${Math.floor(rand() * 3)}`]);
  }
  return runs;
};

/** Per-character styles of a run layout. */
const stylesOf = (runs: [string, string][]): string[] =>
  runs.flatMap(([text, style]) => [...text].map(() => style));

/** Character offsets where a run starts, plus the end. */
const boundsOf = (runs: [string, string][]): number[] => {
  const out = [0];
  for (const [text] of runs) out.push(out.at(-1)! + text.length);
  return out;
};

const fakeFigma = (lookup: Record<string, unknown>, fonts: { loaded: boolean }) =>
  ({
    mixed: Symbol('mixed'),
    loadFontAsync: vi.fn<() => Promise<void>>(async () => {
      fonts.loaded = true;
    }),
    getNodeByIdAsync: async (id: string) => lookup[id] ?? null,
    currentPage: { findAllWithCriteria: () => Object.values(lookup) },
  }) as unknown as typeof figma;

describe('set_text against assigning characters', () => {
  it(`agrees on the text and keeps only whole shared runs, over ${CASES} random edits`, async () => {
    const rand = prng(SEED);
    // Collected rather than asserted one by one, so a failure lists every case that broke.
    const failures: string[] = [];
    for (let c = 0; c < CASES; c += 1) {
      const runs = randomRuns(rand);
      const before = runs.map(([t]) => t).join('');
      const next = rand() < 0.5 ? word(rand, 12) : mutate(rand, before);
      const fonts = { loaded: false };
      const node = makeText('1:1', runs, fonts);
      await createSetTextHandler(fakeFigma({ '1:1': node }, fonts))({
        nodeId: '1:1',
        characters: next,
      });
      const where = `case ${c}: ${JSON.stringify(runs)} -> ${JSON.stringify(next)}`;

      // 1. The text is exactly what the old assignment produced.
      if (node.characters !== next)
        failures.push(`${where}: text ${JSON.stringify(node.characters)}`);

      // 2–3. Split the result into the longest prefix and suffix that are whole input runs, kept
      // verbatim in text and style; what lies between must be one style.
      const input = stylesOf(runs);
      const output = stylesOf(node.runs());
      const bounds = boundsOf(runs);
      let prefix = 0;
      for (const b of bounds) {
        if (
          b <= Math.min(before.length, next.length) &&
          before.slice(0, b) === next.slice(0, b) &&
          input.slice(0, b).join() === output.slice(0, b).join()
        ) {
          prefix = b;
        }
      }
      let suffix = 0;
      for (const b of bounds) {
        const len = before.length - b;
        if (
          len <= next.length - prefix &&
          len <= before.length - prefix &&
          before.slice(b) === next.slice(next.length - len) &&
          input.slice(b).join() === output.slice(output.length - len).join()
        ) {
          suffix = Math.max(suffix, len);
        }
      }
      const middle = output.slice(prefix, output.length - suffix);
      if (new Set(middle).size > 1) {
        failures.push(`${where}: rewritten text in ${new Set(middle).size} styles`);
      }

      // 4. With no whole run shared, the result is the old one: everything in the first style.
      const allFirst = output.every(style => style === input[0]);
      if (prefix === 0 && suffix === 0 && next.length > 0 && !allFirst) {
        failures.push(`${where}: differs from assigning`);
      }
    }
    expect(failures).toEqual([]);
  });
});

/** A plausible edit of `s`: change, insert or drop one span. */
function mutate(rand: () => number, s: string): string {
  const at = Math.floor(rand() * (s.length + 1));
  const len = Math.floor(rand() * 3);
  return s.slice(0, at) + word(rand, 3) + s.slice(Math.min(s.length, at + len));
}

describe('find_replace_text against assigning characters', () => {
  const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  it(`agrees on the text and restyles only the matches, over ${CASES} random replacements`, async () => {
    const rand = prng(SEED + 1);
    const failures: string[] = [];
    for (let c = 0; c < CASES; c += 1) {
      const runs = randomRuns(rand);
      const before = runs.map(([t]) => t).join('');
      const find = word(rand, 3) || 'a';
      const replace = word(rand, 4);
      const caseSensitive = rand() < 0.5;
      const fonts = { loaded: false };
      const node = makeText('1:1', runs, fonts);
      await createFindReplaceTextHandler(fakeFigma({ '1:1': node }, fonts))({
        find,
        replace,
        caseSensitive,
      });
      const where = `case ${c}: ${JSON.stringify(runs)} /${find}/ -> ${JSON.stringify(replace)}`;

      // 1. The text is exactly what the old replacement produced.
      const expected = caseSensitive
        ? before.split(find).join(replace)
        : before.replace(new RegExp(escape(find), 'gi'), replace);
      if (node.characters !== expected) {
        failures.push(`${where}: text ${JSON.stringify(node.characters)}`);
      }

      // 2–3. Walk the input: untouched characters keep their style; each replacement is wholly in
      // the style of the first character it replaced.
      const input = stylesOf(runs);
      const output = stylesOf(node.runs());
      const pattern = new RegExp(escape(find), caseSensitive ? 'g' : 'gi');
      let out = 0;
      let last = 0;
      for (const hit of before.matchAll(pattern)) {
        for (let i = last; i < hit.index; i += 1) {
          if (output[out] !== input[i]) failures.push(`${where}: untouched char ${i} restyled`);
          out += 1;
        }
        for (let k = 0; k < replace.length; k += 1) {
          if (output[out] !== input[hit.index]) {
            failures.push(`${where}: replacement at ${hit.index} not in the replaced style`);
          }
          out += 1;
        }
        last = hit.index + hit[0].length;
      }
      for (let i = last; i < before.length; i += 1) {
        if (output[out] !== input[i]) failures.push(`${where}: untouched char ${i} restyled`);
        out += 1;
      }
      if (out !== output.length) failures.push(`${where}: ${output.length - out} extra characters`);
    }
    expect(failures).toEqual([]);
  });
});
