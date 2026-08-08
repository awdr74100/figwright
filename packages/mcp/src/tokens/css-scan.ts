// A lexical scanner for CSS custom-property declarations — not a CSS parser.
//
// It never interprets selector syntax, at-rule semantics, or value grammar. It tracks exactly three
// things: whether the cursor sits inside a comment, inside a string, and how deep it is in braces.
// That is the minimum needed to answer "which block does this `--name: value` belong to", and it is
// precisely what a regex cannot know.
//
// The regex this replaces (`/--([a-zA-Z0-9-]+)\s*:\s*([^;]+);/g` over comment-stripped text) failed
// in two ways that a differential test against postcss over 401 real stylesheets made concrete:
//
//   1. `[^;]+;` requires a terminating semicolon, so the last declaration of a block — which in
//      minified CSS never has one — swallowed the `}` and everything up to the next `;`. Real
//      example from @picocss/pico: `--pico-font-size` parsed as
//      `106.25%}}@media (min-width:768px){:host,:root{--pico-font-size:112.5%}}@media (min-width:1…`
//      rather than `100%`. 1,619 declarations were corrupted this way.
//   2. Comment stripping by regex ate real content: `url("http://x/*y*/z.png")` became
//      `url("http://xz.png")`, because `/*` inside a string is not a comment.
//
// Robustness rule for everything below: this reads *other people's* repositories, so malformed CSS
// must degrade, never throw. Unterminated strings and comments run to end-of-input and the scan
// returns what it collected. postcss raises `unclosed string` here; failing the whole grounding call
// because one vendored stylesheet is truncated would be strictly worse than reading the rest.

/** One `--name: value` declaration, with the block chain it was found in. */
export interface CssDeclaration {
  /** Custom property name without the leading `--`. */
  name: string;
  /** Raw value as written, trimmed, with a trailing `!important` removed. */
  value: string;
  /** The innermost enclosing prelude — a selector (`:root`, `.dark`) or at-rule (`@theme`). */
  scope: string;
  /** Enclosing preludes outside `scope`, outermost first (e.g. `['@media (min-width: 60rem)']`). */
  ancestors: string[];
}

const isWhitespace = (c: string): boolean =>
  c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';

// Custom property names are `<ident>`, which allows escapes (`--a\;b`) and any non-ASCII character.
// Kept permissive on purpose: a name we mis-delimit becomes a wrong token, while a name we accept
// that CSS would reject simply never matches anything on the Figma side.
const isNameChar = (c: string): boolean =>
  !isWhitespace(c) &&
  c !== ':' &&
  c !== ';' &&
  c !== '{' &&
  c !== '}' &&
  c !== '(' &&
  c !== ')' &&
  c !== '[' &&
  c !== ']' &&
  c !== '"' &&
  c !== "'" &&
  c !== ',' &&
  c !== '/' &&
  c !== '!';

/**
 * Scan every custom-property declaration in a stylesheet, in document order, each tagged with the
 * block chain it appears in. Pure, total (never throws), and order-preserving — callers decide
 * which declaration of a repeated name wins, which is a question this layer deliberately does not
 * answer.
 */
export const scanCustomProperties = (css: string): CssDeclaration[] => {
  const out: CssDeclaration[] = [];
  // Preludes of the blocks currently open, outermost first.
  const stack: string[] = [];
  // Text seen since the last `{`, `}` or `;` — the prelude of the block we may be about to enter.
  let prelude = '';
  let i = 0;
  const n = css.length;

  /** Consume a quoted string starting at the opening quote; returns it including both quotes. */
  const readString = (): string => {
    const quote = css[i];
    let text = quote as string;
    i += 1;
    while (i < n) {
      const c = css[i] as string;
      if (c === '\\') {
        // An escape consumes the next code unit whatever it is, so `\"` cannot close the string.
        text += c + (css[i + 1] ?? '');
        i += 2;
        continue;
      }
      text += c;
      i += 1;
      if (c === quote) break;
    }
    return text;
  };

  /** Skip a block comment starting at its opening slash; an unterminated one runs to end-of-input. */
  const skipComment = (): void => {
    const end = css.indexOf('*/', i + 2);
    i = end < 0 ? n : end + 2;
  };

  /**
   * Read a declaration value, starting just after the `:`. Stops at the `;` that ends it or the `}`
   * that ends its block — but only when that character is at paren depth 0 and outside any string
   * or comment, so `url(http://a/b;c.png)` and `content: "}"` survive intact.
   */
  const readValue = (): string => {
    let value = '';
    let depth = 0;
    while (i < n) {
      const c = css[i] as string;
      if (c === '/' && css[i + 1] === '*') {
        skipComment();
        continue;
      }
      if (c === '"' || c === "'") {
        value += readString();
        continue;
      }
      if (c === '\\') {
        value += c + (css[i + 1] ?? '');
        i += 2;
        continue;
      }
      if (c === '(') depth += 1;
      else if (c === ')') depth = Math.max(0, depth - 1);
      else if (depth === 0 && (c === ';' || c === '}')) break;
      value += c;
      i += 1;
    }
    // `!important` is a declaration flag rather than part of the value; keeping it would make the
    // same token compare unequal to its unflagged twin in the value-match join.
    return value
      .trim()
      .replace(/\s*!\s*important\s*$/i, '')
      .trim();
  };

  while (i < n) {
    const c = css[i] as string;

    if (c === '/' && css[i + 1] === '*') {
      skipComment();
      continue;
    }

    // Strings can appear in a prelude too — attribute selectors (`[data-theme="dark;x"]`), `@import`
    // urls, `@supports` conditions — and must not be scanned for structure.
    if (c === '"' || c === "'") {
      prelude += readString();
      continue;
    }

    if (c === '\\') {
      prelude += c + (css[i + 1] ?? '');
      i += 2;
      continue;
    }

    if (c === '{') {
      stack.push(prelude.trim().replace(/\s+/g, ' '));
      prelude = '';
      i += 1;
      continue;
    }

    if (c === '}') {
      stack.pop();
      prelude = '';
      i += 1;
      continue;
    }

    if (c === ';') {
      prelude = '';
      i += 1;
      continue;
    }

    // A custom property can only begin a declaration: inside a block, with nothing but whitespace
    // since the last separator. The prelude guard is what keeps `color: var(--x)` from registering
    // `--x` as a declaration — there, the prelude holds `color: var(` when `--x` is reached.
    if (c === '-' && css[i + 1] === '-' && stack.length > 0 && prelude.trim() === '') {
      const start = i;
      let j = i + 2;
      while (j < n) {
        const d = css[j] as string;
        if (d === '\\') {
          j += 2;
          continue;
        }
        if (!isNameChar(d)) break;
        j += 1;
      }
      let k = j;
      while (k < n && isWhitespace(css[k] as string)) k += 1;
      // Only a `:` makes this a declaration; a bare `--x` in a prelude is a selector fragment.
      if (css[k] === ':' && j > i + 2) {
        const name = css.slice(i + 2, j);
        i = k + 1;
        const value = readValue();
        // An empty value (`--x:;`) declares nothing usable for a design-token join, and the
        // implementation this replaces skipped it too — kept, so the change is not a silent
        // widening of what counts as a token.
        if (value.length > 0) {
          out.push({
            name,
            value,
            scope: stack[stack.length - 1] ?? '',
            ancestors: stack.slice(0, -1),
          });
        }
        continue;
      }
      // Not a declaration after all — fall through and treat it as prelude text.
      i = start;
    }

    prelude += c;
    i += 1;
  }

  return out;
};
