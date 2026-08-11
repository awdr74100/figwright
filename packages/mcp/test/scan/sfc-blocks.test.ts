import { describe, expect, it } from 'vitest';

import { scanSfcScripts } from '../../src/scan/sfc-blocks.js';

const vue = (code: string) => scanSfcScripts(code, { templateIsBlock: true });
const svelte = (code: string) => scanSfcScripts(code, { templateIsBlock: false });

describe('scanSfcScripts — block delimitation', () => {
  // The regex this replaced used `[^>]*` for the attribute list, so the first `>` inside a quoted
  // value ended the tag and the body began mid-attribute. Vue 3.3+ generic components are exactly
  // where that `>` shows up, and they are the components a design system needs variant axes from.
  it('does not end the open tag at a `>` inside a quoted attribute value', () => {
    const { blocks } = vue(
      '<script setup lang="ts" generic="T extends Record<string, unknown>">\nconst a = 1\n</script>',
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.body).toBe('\nconst a = 1\n');
    expect(blocks[0]?.lang).toBe('ts');
  });

  it.each([
    ['single quotes', `<script lang='ts' data-x='a>b'>X</script>`],
    ['unquoted value', '<script lang=ts data-x=ab>X</script>'],
    ['spaces around equals', '<script lang = "ts" >X</script>'],
    ['attributes across newlines', '<script\n  setup\n  lang="ts"\n>X</script>'],
    ['uppercase tag and attributes', '<SCRIPT SETUP LANG="TS">X</SCRIPT>'],
  ])('reads the block through %s', (_label, code) => {
    const { blocks } = vue(code);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.body).toBe('X');
    expect(blocks[0]?.lang).toBe('ts');
  });

  it('ignores a script block that is commented out', () => {
    // A live regex over the raw text extracted this one and merged its defineProps names into the
    // result — a prop the component does not declare, reported as a complete list.
    const { blocks } = vue(
      '<!--\n<script setup lang="ts">const dead = 1</script>\n-->\n<script setup lang="ts">const live = 1</script>',
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.body).toBe('const live = 1');
  });

  it("ignores a <script> nested in Vue's <template> (a JSON-LD block, say)", () => {
    const { blocks } = vue(
      '<script setup lang="ts">const a = 1</script>\n<template><script type="application/ld+json">{"a":1}</script></template>',
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.body).toBe('const a = 1');
  });

  it('counts nested <template> so a slot template does not end the block early', () => {
    const { blocks } = vue(
      '<template><div><template #head><b/></template></div></template>\n<script setup lang="ts">const a = 1</script>',
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.body).toBe('const a = 1');
  });

  it('is not fooled by end tags appearing inside attribute values or raw text', () => {
    expect(
      vue('<template><div title="</template>"><b/></div></template><script>A</script>').blocks[0]
        ?.body,
    ).toBe('A');
    expect(
      vue('<style>.a::after{content:"</script>"}</style><script>B</script>').blocks[0]?.body,
    ).toBe('B');
    expect(vue('<script lang="ts" data-x="</script>">C</script>').blocks[0]?.body).toBe('C');
  });

  it('applies the raw-text end-tag rule: a delimiter must follow the name', () => {
    // `</scriptx>` does not close a `<script>`; `</script >` does.
    expect(vue('<script>a</scriptx>b</script>').blocks[0]?.body).toBe('a</scriptx>b');
    expect(vue('<script>a</script >').blocks[0]?.body).toBe('a');
    expect(vue('<script>a</script\n>').blocks[0]?.body).toBe('a');
  });

  it('keeps every top-level block, in document order', () => {
    const { blocks } = vue(
      '<script lang="ts">FIRST</script>\n<script setup lang="ts">SECOND</script>',
    );
    expect(blocks.map(b => b.body)).toEqual(['FIRST', 'SECOND']);
  });
});

describe('scanSfcScripts — dialect', () => {
  it.each([
    ['', 'js'],
    [' lang="js"', 'js'],
    [' lang="javascript"', 'js'],
    [' lang="jsx"', 'jsx'],
    [' lang="ts"', 'ts'],
    [' lang=ts', 'ts'],
    [` lang='ts'`, 'ts'],
    [' lang="TS"', 'ts'],
    [' lang="typescript"', 'ts'],
    [' lang="tsx"', 'tsx'],
    [' lang=""', 'js'],
    [' lang', 'js'],
  ])('maps%s to the %s dialect', (attr, expected) => {
    expect(vue(`<script${attr}>X</script>`).blocks[0]?.lang).toBe(expected);
  });

  it('reports a dialect it has no parser for as null rather than guessing JS', () => {
    // Parsing CoffeeScript as JavaScript would report "no props" for a block whose props are
    // simply unread — the false claim propsExtracted exists to prevent.
    expect(vue('<script lang="coffee">a = 1</script>').blocks[0]?.lang).toBeNull();
  });
});

describe('scanSfcScripts — external sources', () => {
  it('flags a src= block, whose body is not the source', () => {
    const { blocks } = vue('<script src="./C.ts" lang="ts"></script>');
    expect(blocks[0]?.external).toBe(true);
    expect(blocks[0]?.body).toBe('');
  });

  it('flags a self-closed src= block without swallowing the rest of the file', () => {
    const { blocks } = vue('<script src="./C.ts" lang="ts" />\n<template><b/></template>');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.external).toBe(true);
  });

  it('does not flag an ordinary block as external', () => {
    expect(vue('<script lang="ts">X</script>').blocks[0]?.external).toBe(false);
  });
});

describe('scanSfcScripts — delimitation failures', () => {
  // Each of these leaves content unread. Reporting `unterminated` is what stops the caller from
  // turning "no blocks found" into a positive "this component declares no props".
  it.each([
    ['an unclosed script', '<script setup lang="ts">const a = 1'],
    ['an unclosed comment', '<!-- <script lang="ts">const a = 1</script>'],
    ['an unterminated attribute value', '<script lang="ts" x="oops>const a = 1</script>'],
    ['an unclosed template', '<template><div><template #a></template><script>A</script>'],
    ['an unclosed style', '<style>.a{}<script>A</script>'],
  ])('reports %s as unterminated', (_label, code) => {
    expect(vue(code).unterminated).toBe(true);
  });

  it.each([
    ['an empty file', ''],
    ['plain text', 'hello world'],
    ['a script-less template', '<template><b/></template>'],
    ['a complete file', '<script lang="ts">A</script><template><b/></template><style>.a{}</style>'],
  ])('does not report %s as unterminated', (_label, code) => {
    expect(vue(code).unterminated).toBe(false);
  });
});

describe('scanSfcScripts — Svelte', () => {
  it('finds both the module and the instance block, in either spelling', () => {
    for (const attr of [' module', ' context="module"']) {
      const { blocks } = svelte(
        `<script${attr} lang="ts">MODULE</script><script lang="ts">INSTANCE</script>`,
      );
      expect(blocks.map(b => b.body)).toEqual(['MODULE', 'INSTANCE']);
    }
  });

  it('treats <template> as ordinary markup, not as a block to skip', () => {
    // Vue's markup lives in a <template> block; Svelte's markup *is* the top level, where
    // <template> carries no special meaning.
    const { blocks } = svelte('<template><b/></template><script lang="ts">A</script>');
    expect(blocks.map(b => b.body)).toEqual(['A']);
  });
});

describe('scanSfcScripts — totality', () => {
  // The contract this module inherits from css-scan: it reads *other people's* repositories, so
  // malformed input must degrade, never throw. Property-checked rather than case-checked, because
  // the inputs that break a hand-written scanner are the ones nobody thought to write down.
  const mulberry = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const PIECES = [
    '<script',
    '</script',
    '<script setup lang="ts">',
    '</script>',
    '<template>',
    '</template>',
    '<!--',
    '-->',
    '<style>',
    '</style>',
    '"',
    "'",
    '>',
    '<',
    '/',
    '=',
    'lang',
    'generic',
    'src',
    '<template #a>',
    '<script src="x"/>',
    '\n',
    '\r\n',
    '\t',
    ' ',
    '\u{1f4a5}',
    'İ',
  ];

  it('never throws on structural noise', () => {
    const rand = mulberry(20260812);
    for (let n = 0; n < 4000; n++) {
      let code = '';
      for (let k = 1 + Math.floor(rand() * 14); k > 0; k--) {
        code += PIECES[Math.floor(rand() * PIECES.length)];
      }
      expect(() => vue(code)).not.toThrow();
      expect(() => svelte(code)).not.toThrow();
    }
  });

  it('never throws on any prefix or single-character edit of a realistic SFC', () => {
    // A truncated file is the realistic failure — a half-written component, a partial read.
    const real =
      '<!-- note -->\n<script lang="ts">\nexport interface P { a: string }\n</script>\n<script setup lang="ts" generic="T extends Record<string, unknown>">\nconst p = defineProps<P>()\n</script>\n<template><div><template #x><b/></template></div></template>\n<style>.a{}</style>\n';
    for (let i = 0; i <= real.length; i++) {
      expect(() => vue(real.slice(0, i))).not.toThrow();
    }
    for (let i = 0; i < real.length; i++) {
      expect(() => vue(real.slice(0, i) + real.slice(i + 1))).not.toThrow();
      expect(() => vue(real.slice(0, i) + String(real[i]) + real.slice(i))).not.toThrow();
    }
  });
});
