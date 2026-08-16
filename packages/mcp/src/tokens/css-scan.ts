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
 * What separates the two dialects this scanner reads. Everything else — comment/string/brace
 * tracking, the prelude guard, `url(a;b)` and `content: "}"` surviving intact — is identical, which
 * is why they share one implementation rather than a copy that drifts.
 */
interface Dialect {
  /** What begins a declaration: `--` for a CSS custom property, `$` for a SCSS variable. */
  sigil: string;
  /**
   * Whether the declaration must sit inside a block. A CSS custom property does; a SCSS variable is
   * normally top-level, and one written _inside_ a rule is scoped to that rule — not referenceable
   * from anywhere else, so it must not become a token. That filtering is the caller's, from
   * `scope`.
   */
  requireBlock: boolean;
  /**
   * Whether `//` starts a comment, and — inseparably — whether `url(…)` needs protecting from it.
   * The two travel together: a stylesheet is full of `url(http://…)` and `url(//cdn…)`, whose `//`
   * is not a comment in any dialect, but only a dialect that _has_ line comments can mistake it for
   * one. Getting this wrong is not a missed token: the phantom comment eats the rest of the line
   * including its `)` and `;`, so the block never closes and every later declaration is either
   * tagged with a bogus scope or swallowed into a value.
   *
   * SCSS has `//`; CSS does not (there it is ordinary text).
   */
  lineComments: boolean;
  /**
   * Whether `#{…}` interpolation can appear in a value. Its closing `}` must not be read as the end
   * of the enclosing block, or the value truncates at the interpolation. SCSS only.
   */
  interpolation: boolean;
  /** Declaration flags to strip from the tail of a value; repeated, since Sass allows several. */
  flags: RegExp;
}

const CSS_DIALECT: Dialect = {
  sigil: '--',
  requireBlock: true,
  lineComments: false,
  interpolation: false,
  // `!important` is a declaration flag rather than part of the value; keeping it would make the
  // same token compare unequal to its unflagged twin in the value-match join. Deliberately not
  // repeated the way the SCSS flags are: a second `!important` is invalid CSS, and widening this
  // would change what the CSS path returns for an input main handles differently — the one
  // guarantee this generalization owes is that CSS output is untouched.
  flags: /\s*!\s*important\s*$/i,
};

const SCSS_DIALECT: Dialect = {
  sigil: '$',
  requireBlock: false,
  lineComments: true,
  interpolation: true,
  // `!default` is how a SCSS variable declares itself overridable; `!global` how a scoped one
  // escapes its block. Both are flags on the declaration, not part of the value, and Sass accepts
  // both on one declaration (`4px !default !global`) — so the strip repeats.
  flags: /(\s*!\s*(default|global))+\s*$/i,
};

/**
 * A CSS custom property declared _in a SCSS file_. Same `--name` sigil and block requirement as
 * plain CSS, but the file around it is Sass — so `//` is a comment and `#{}` is interpolation.
 * Reading such a file with the plain-CSS dialect silently dropped every custom property that
 * followed a `//` comment, and all of them when such a comment contained a `}`.
 */
const SCSS_CUSTOM_PROPERTY_DIALECT: Dialect = {
  ...CSS_DIALECT,
  lineComments: true,
  interpolation: true,
};

/**
 * Scan every custom-property declaration in a stylesheet, in document order, each tagged with the
 * block chain it appears in. Pure, total (never throws), and order-preserving — callers decide
 * which declaration of a repeated name wins, which is a question this layer deliberately does not
 * answer.
 *
 * `scssSyntax` when the text is a `.scss` file: the declarations are the same, the syntax around
 * them is not.
 */
export const scanCustomProperties = (css: string, scssSyntax = false): CssDeclaration[] =>
  scanDeclarations(css, scssSyntax ? SCSS_CUSTOM_PROPERTY_DIALECT : CSS_DIALECT);

/**
 * The same scan over SCSS `$name: value` declarations. `scope` is empty for a module-level variable
 * and holds the enclosing rule for one declared inside a block — which the caller must drop, since
 * such a variable is local to that rule and referencing it from elsewhere does not compile.
 */
export const scanScssVariables = (scss: string): CssDeclaration[] =>
  scanDeclarations(scss, SCSS_DIALECT);

const scanDeclarations = (css: string, dialect: Dialect): CssDeclaration[] => {
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
   * True at the start of `url(` — checked before any comment test, because an unquoted url is raw
   * text to a Sass parser and routinely contains `//` (`url(http://…)`, `url(//cdn…)`). The
   * preceding character must not be part of a longer identifier, so `myurl(` is not a url.
   */
  const atUrl = (): boolean =>
    dialect.lineComments &&
    css.slice(i, i + 4).toLowerCase() === 'url(' &&
    !(i > 0 && isNameChar(css[i - 1] as string));

  /** Consume `url(` through its matching `)`, verbatim; an unterminated one runs to end-of-input. */
  const readUrl = (): string => {
    // Take the `url(` itself first, so the depth starts at 1 — counting from zero would end the
    // read on the very first character, which is not a paren.
    let text = css.slice(i, i + 4);
    i += 4;
    let depth = 1;
    while (i < n && depth > 0) {
      const c = css[i] as string;
      if (c === '"' || c === "'") {
        text += readString();
        continue;
      }
      if (c === '(') depth += 1;
      else if (c === ')') depth -= 1;
      text += c;
      i += 1;
    }
    return text;
  };

  /** True at the start of a comment this dialect recognises. */
  const atComment = (): boolean =>
    css[i] === '/' && (css[i + 1] === '*' || (dialect.lineComments && css[i + 1] === '/'));

  /** Skip whichever comment form starts here. A `//` runs to the newline, or to end-of-input. */
  const skipAnyComment = (): void => {
    if (css[i + 1] === '*') {
      skipComment();
      return;
    }
    const end = css.indexOf('\n', i + 2);
    i = end < 0 ? n : end + 1;
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
      if (atUrl()) {
        value += readUrl();
        continue;
      }
      if (atComment()) {
        skipAnyComment();
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
      // `#{` opens an interpolation whose `}` closes it rather than the enclosing block. Counted on
      // the same depth as parens: this is a lexical scanner, and on malformed input the rule that
      // matters is that it degrades rather than throws.
      if (dialect.interpolation && c === '#' && css[i + 1] === '{') {
        depth += 1;
        value += '#{';
        i += 2;
        continue;
      }
      if (c === '(') depth += 1;
      else if (c === ')') depth = Math.max(0, depth - 1);
      else if (dialect.interpolation && c === '}' && depth > 0) depth -= 1;
      else if (depth === 0 && (c === ';' || c === '}')) break;
      value += c;
      i += 1;
    }
    return value.trim().replace(dialect.flags, '').trim();
  };

  while (i < n) {
    const c = css[i] as string;

    // A url in a *prelude* position — `@import url(https://…);` is a common first line — must be
    // consumed whole for the same reason: its `//` is not a comment and its `)` and `;` are real.
    if (atUrl()) {
      prelude += readUrl();
      continue;
    }

    if (atComment()) {
      skipAnyComment();
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

    // A declaration begins with nothing but whitespace since the last separator — the prelude guard
    // is what keeps `color: var(--x)` and `color: $x` from registering as declarations, since there
    // the prelude holds `color: var(` / `color: ` when the sigil is reached. CSS additionally
    // requires a block; a SCSS variable is normally top-level.
    const sigilLen = dialect.sigil.length;
    if (
      css.startsWith(dialect.sigil, i) &&
      (!dialect.requireBlock || stack.length > 0) &&
      prelude.trim() === ''
    ) {
      const start = i;
      let j = i + sigilLen;
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
      if (css[k] === ':' && j > i + sigilLen) {
        const name = css.slice(i + sigilLen, j);
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
