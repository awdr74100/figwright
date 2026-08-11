// A lexical scanner for the top-level `<script>` blocks of a single-file component — not an HTML
// parser. Same shape, and the same reason, as tokens/css-scan.ts: it tracks only what is needed to
// answer "which top-level blocks does this file declare, and what dialect is each written in", and
// that is precisely what a regex cannot know.
//
// The regex this replaces (`/<script\b([^>]*)>([\s\S]*?)<\/script>/gi`) failed in four ways that an
// end-to-end run of extractSfcComponent made concrete:
//
//   1. `[^>]*` stops at the first `>`, including one inside a quoted attribute value. Vue 3.3+
//      `<script setup lang="ts" generic="T extends Record<string, unknown>">` therefore yielded a
//      body beginning `">`, which does not parse — so every generic component's props read as
//      absent. (Exactly the components a design system needs variant axes from.)
//   2. `lang` was matched as `/\blang=["']ts["']/`, so `lang="tsx"` and the unquoted `lang=ts` both
//      fell back to the JS dialect, where `defineProps<{…}>()` is a syntax error.
//   3. It has no notion of comments, so a commented-out `<!-- <script setup>…</script> -->` was
//      extracted as a live block and its `defineProps` names merged into the result — a phantom
//      prop reported with propsExtracted: true.
//   4. It has no notion of nesting, so a `<script>` inside Vue's `<template>` (a JSON-LD block, for
//      instance) was read as a top-level block.
//
// Robustness rule, inherited from css-scan: this reads *other people's* repositories, so malformed
// input must degrade, never throw. Unterminated tags, strings and comments run to end-of-input and
// the scan returns what it collected.
//
// One thing it deliberately does NOT model: a `</script>` inside a string literal in the script
// body still ends the block. That is not a bug — `<script>` is raw text, and Vue's and Svelte's own
// parsers end the block there too, which is why the escape `"<\/script>"` exists.

/** The parser dialect a block is written in, decided by its `lang` attribute. */
export type ScriptLang = 'ts' | 'tsx' | 'js' | 'jsx';

export interface SfcScriptBlock {
  /** Raw text between the open tag and its end tag. Empty for a `src=` or self-closed block. */
  body: string;
  /**
   * Null when the block declares a `lang` we have no parser for (`coffee`, `pug`, …). Its props are
   * unread rather than absent, which is a different claim — see extractSfcComponent.
   */
  lang: ScriptLang | null;
  /** True when `src` points the real source at another file, so `body` is not the source. */
  external: boolean;
}

export interface SfcScriptScan {
  blocks: SfcScriptBlock[];
  /**
   * The file could not be fully delimited: a `<script>`, `<style>`, `<template>`, comment or open
   * tag ran to end-of-input without closing. The scan still returns what it collected — but the
   * caller must not read "no blocks" as "genuinely no script", because content went unread.
   */
  unterminated: boolean;
}

export interface SfcScanOptions {
  /**
   * Whether a top-level `<template>` wraps markup that must not be searched for script blocks. True
   * for Vue (the SFC's markup lives in that block); false for Svelte, whose markup _is_ the top
   * level and where `<template>` carries no special meaning.
   */
  templateIsBlock: boolean;
}

// HTML whitespace, which is not the same set as JS whitespace.
const isSpace = (c: string | undefined): boolean =>
  c === ' ' || c === '\t' || c === '\n' || c === '\f' || c === '\r';

const isAsciiAlpha = (c: string | undefined): boolean => {
  if (c === undefined) return false;
  const n = c.charCodeAt(0);
  return (n >= 65 && n <= 90) || (n >= 97 && n <= 122);
};

/**
 * Case-insensitive ASCII compare of `name` against src at `i`, without lowercasing the source —
 * String.toLowerCase can change a string's length (İ → i̇), which would desync every index.
 */
const matchesNameAt = (src: string, i: number, name: string): boolean => {
  if (i + name.length > src.length) return false;
  for (let k = 0; k < name.length; k++) {
    const c = src.charCodeAt(i + k);
    if ((c >= 65 && c <= 90 ? c + 32 : c) !== name.charCodeAt(k)) return false;
  }
  return true;
};

/** Index just past the next `>`, or end-of-input when the tag never closes. */
const skipToGt = (src: string, from: number): number => {
  const at = src.indexOf('>', from);
  return at === -1 ? src.length : at + 1;
};

interface OpenTag {
  /** Lowercased tag name. */
  name: string;
  /** Lowercased attribute names → raw values (empty string for a valueless attribute). */
  attrs: Map<string, string>;
  /** Index just past the tag's `>`, or end-of-input when it never closed. */
  end: number;
  selfClosing: boolean;
  /** False when the tag ran to end-of-input — an unterminated attribute value, typically. */
  closed: boolean;
}

/**
 * Parse an open tag beginning at the `<` at `start`. Returns null when that `<` does not begin a
 * tag (bare `<` in text). Attribute values are read with their quoting, so a `>` inside one — the
 * `generic="T extends Record<string, unknown>"` case — does not end the tag.
 */
const readOpenTag = (src: string, start: number): OpenTag | null => {
  let i = start + 1;
  if (!isAsciiAlpha(src[i])) return null;
  const nameStart = i;
  while (i < src.length && !isSpace(src[i]) && src[i] !== '>' && src[i] !== '/') i++;
  const name = src.slice(nameStart, i).toLowerCase();

  const attrs = new Map<string, string>();
  let selfClosing = false;
  let closed = false;
  while (i < src.length) {
    while (i < src.length && isSpace(src[i])) i++;
    if (i >= src.length) break;
    if (src[i] === '>') {
      i++;
      closed = true;
      break;
    }
    if (src[i] === '/') {
      if (src[i + 1] === '>') {
        selfClosing = true;
        closed = true;
        i += 2;
        break;
      }
      i++;
      continue;
    }
    const attrStart = i;
    while (
      i < src.length &&
      !isSpace(src[i]) &&
      src[i] !== '=' &&
      src[i] !== '>' &&
      src[i] !== '/'
    ) {
      i++;
    }
    // No progress means a character none of the branches above consume; step over it so a malformed
    // tag can never spin forever.
    if (i === attrStart) {
      i++;
      continue;
    }
    const attrName = src.slice(attrStart, i).toLowerCase();
    while (i < src.length && isSpace(src[i])) i++;
    let value = '';
    if (src[i] === '=') {
      i++;
      while (i < src.length && isSpace(src[i])) i++;
      const quote = src[i];
      if (quote === '"' || quote === "'") {
        i++;
        const close = src.indexOf(quote, i);
        if (close === -1) {
          value = src.slice(i);
          i = src.length;
        } else {
          value = src.slice(i, close);
          i = close + 1;
        }
      } else {
        const valueStart = i;
        while (i < src.length && !isSpace(src[i]) && src[i] !== '>') i++;
        value = src.slice(valueStart, i);
      }
    }
    attrs.set(attrName, value);
  }
  return { name, attrs, end: i, selfClosing, closed };
};

/**
 * Index of the `<` beginning the raw-text end tag for `name`, per the HTML rule that the name must
 * be followed by whitespace, `/` or `>` — so `</scriptx>` does not close a `<script>`, and
 * `</script >` does. -1 when the block never closes.
 */
const findRawTextEnd = (src: string, from: number, name: string): number => {
  for (let i = from; i < src.length; i++) {
    if (src[i] !== '<' || src[i + 1] !== '/') continue;
    if (!matchesNameAt(src, i + 2, name)) continue;
    const after = src[i + 2 + name.length];
    if (after !== undefined && (isSpace(after) || after === '>' || after === '/')) return i;
  }
  return -1;
};

/** Index just past `<!-- … -->`. `closed` is false when the comment ran to end-of-input. */
const skipComment = (src: string, from: number): { end: number; closed: boolean } => {
  const end = src.indexOf('-->', from + 4);
  return end === -1 ? { end: src.length, closed: false } : { end: end + 3, closed: true };
};

/**
 * Index just past the end tag matching an element already opened at `from`, counting same-name
 * nesting (`<template #header>` inside Vue's `<template>`). Raw-text children are jumped wholesale,
 * so text inside a nested `<script>`/`<style>` can't be mistaken for an end tag.
 */
const skipElement = (src: string, from: number, name: string): { end: number; closed: boolean } => {
  let depth = 1;
  let i = from;
  while (i < src.length) {
    if (src[i] !== '<') {
      i++;
      continue;
    }
    if (src.startsWith('<!--', i)) {
      const comment = skipComment(src, i);
      if (!comment.closed) return { end: comment.end, closed: false };
      i = comment.end;
      continue;
    }
    if (src[i + 1] === '/') {
      const after = src[i + 2 + name.length];
      if (
        matchesNameAt(src, i + 2, name) &&
        after !== undefined &&
        (isSpace(after) || after === '>' || after === '/')
      ) {
        depth--;
        i = skipToGt(src, i);
        if (depth === 0) return { end: i, closed: true };
        continue;
      }
      i = skipToGt(src, i);
      continue;
    }
    const tag = readOpenTag(src, i);
    if (tag === null) {
      i++;
      continue;
    }
    if (tag.name === 'script' || tag.name === 'style') {
      const rawEnd = findRawTextEnd(src, tag.end, tag.name);
      if (rawEnd === -1) return { end: src.length, closed: false };
      i = skipToGt(src, rawEnd);
      continue;
    }
    if (!tag.closed) return { end: src.length, closed: false };
    if (tag.name === name && !tag.selfClosing) depth++;
    i = tag.end;
  }
  return { end: src.length, closed: false };
};

// Both Vue and Svelte spell TypeScript `ts`; `typescript` and `javascript` are accepted because
// being forgiving here costs nothing — a lang we map wrong reads as a parse failure, which is the
// conservative outcome anyway.
const LANGS: Record<string, ScriptLang> = {
  '': 'js',
  js: 'js',
  javascript: 'js',
  jsx: 'jsx',
  ts: 'ts',
  tsx: 'tsx',
  typescript: 'ts',
};

const langOf = (attrs: Map<string, string>): ScriptLang | null => {
  const raw = attrs.get('lang');
  if (raw === undefined) return 'js';
  return LANGS[raw.trim().toLowerCase()] ?? null;
};

/**
 * Collect every top-level `<script>` block in a `.vue` / `.svelte` file, in document order. Pure,
 * total (never throws), and order-preserving.
 */
export const scanSfcScripts = (code: string, opts: SfcScanOptions): SfcScriptScan => {
  const blocks: SfcScriptBlock[] = [];
  let i = 0;
  // Every `break` below is a delimitation failure: content past this point went unread, so the
  // caller must not turn "no blocks" into a positive "this component declares no props".
  let unterminated = false;
  while (i < code.length) {
    if (code[i] !== '<') {
      i++;
      continue;
    }
    if (code.startsWith('<!--', i)) {
      const comment = skipComment(code, i);
      if (!comment.closed) {
        unterminated = true;
        break;
      }
      i = comment.end;
      continue;
    }
    // A markup declaration / processing instruction / stray end tag carries no block; skip the tag.
    if (code[i + 1] === '!' || code[i + 1] === '?' || code[i + 1] === '/') {
      i = skipToGt(code, i);
      continue;
    }
    const tag = readOpenTag(code, i);
    if (tag === null) {
      i++;
      continue;
    }
    if (!tag.closed) {
      unterminated = true;
      break;
    }
    if (tag.name === 'script') {
      const src = tag.attrs.get('src');
      const external = src !== undefined && src !== '';
      if (tag.selfClosing) {
        blocks.push({ body: '', lang: langOf(tag.attrs), external });
        i = tag.end;
        continue;
      }
      const rawEnd = findRawTextEnd(code, tag.end, 'script');
      if (rawEnd === -1) {
        unterminated = true;
        break;
      }
      blocks.push({ body: code.slice(tag.end, rawEnd), lang: langOf(tag.attrs), external });
      i = skipToGt(code, rawEnd);
      continue;
    }
    if (tag.name === 'style') {
      const rawEnd = findRawTextEnd(code, tag.end, 'style');
      if (rawEnd === -1) {
        unterminated = true;
        break;
      }
      i = skipToGt(code, rawEnd);
      continue;
    }
    if (opts.templateIsBlock && tag.name === 'template' && !tag.selfClosing) {
      const skipped = skipElement(code, tag.end, 'template');
      if (!skipped.closed) {
        unterminated = true;
        break;
      }
      i = skipped.end;
      continue;
    }
    i = tag.end;
  }
  return { blocks, unterminated };
};
