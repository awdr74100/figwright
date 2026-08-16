// Project token parser — the right-hand side of the token join. Reads design tokens out of the
// project's CSS: every `--name: value` declaration. This covers both Tailwind v4 (CSS-first @theme
// block) and plain CSS custom properties (:root), which is why token_map's first cut targets those
// two. Tailwind v3's JS config (theme.colors etc.) needs evaluating/AST-parsing JS and is deferred.
// For v4, the @theme namespaces (--color-*, --spacing-*, …) map to utility base names, so the join
// can suggest `primary-500` (a Tailwind utility) and not just the raw custom property.
//
// Delimiting the declarations is `css-scan.ts`; everything here is the token-level meaning built on
// top of them — the Tailwind namespace derivation, and which block's value leads for a given name.

import { scanCustomProperties, scanScssVariables } from './css-scan.js';

/**
 * How a project token can be referenced in generated code. Which forms exist is a property of the
 * _source_, not of the individual token:
 *
 * - Every CSS source (Tailwind v4 `@theme`, plain `:root` custom properties) declares a custom
 *   property, so `cssVar` is always there; `utility` is derived from the name's namespace when it
 *   has one.
 * - A Tailwind v3 or UnoCSS JS config declares no custom property at all — both inline theme values
 *   into the utilities they generate — so those tokens are utility-only.
 * - A SCSS variable is neither. `$color-primary-500` is the reference, but it only _resolves_ once
 *   the consuming file has pulled the declaring file in, and modern Sass namespaces that: under a
 *   plain `@use './tokens'` the bare `$color-primary-500` is an undefined-variable error and the
 *   reference is `tokens.$color-primary-500`. Verified against dart-sass, not assumed. So a SCSS
 *   token carries the file that declares it and the caller must emit an `@use` for it — the same
 *   shape as `icon_map`, which returns an svg's path rather than fabricating an import specifier.
 *
 * Modelled as a union rather than independent optionals so that {@linkcode refOf} is total by
 * construction: a token with no reference form is not representable, and the compiler proves it.
 * Reaching for `token.name` as a last-resort ref would be exactly the failure this guards — a bare
 * name is not a usable literal in any styling system.
 */
// Each arm spells out the fields it does *not* have, so a consumer can read `token.from` and let
// the compiler narrow, rather than every call site having to re-discriminate first.
type TokenRef =
  | { cssVar: string; utility?: string; scssVar?: undefined; from?: undefined }
  | { cssVar?: undefined; utility: string; scssVar?: undefined; from?: undefined }
  | {
      cssVar?: undefined;
      utility?: undefined;
      /** The reference including its sigil, e.g. `$color-primary-500`. */
      scssVar: string;
      /**
       * Repo-relative path of the file declaring it. Not decoration: without an `@use` naming this
       * file, the reference does not compile, and which form the reference takes depends on how
       * that `@use` is written.
       */
      from: string;
    };

export type ProjectToken = {
  /** Token name; for a CSS source, the custom property without `--`, e.g. "color-primary-500". */
  name: string;
  /** Raw declared value as written, e.g. "#6266F0", "oklch(0.6 0.2 270)", "0.875rem". */
  value: string;
  /** Tailwind token category derived from the namespace, e.g. "color"; absent for plain CSS vars. */
  category?: string;
  /**
   * Whether `utility` is a class the framework actually generates, rather than merely a name stem
   * that happens to start with a namespace prefix.
   *
   * The distinction is not cosmetic. `utility` is derived from the name alone, so a stray `:root {
   * --color-brand: … }` anywhere in the repo yields `brand` — but no framework generates `bg-brand`
   * from a loose custom property. Only a scale declared in a framework config, or a custom property
   * declared inside Tailwind v4's `@theme`, actually produces the class. Emitting the utility for
   * the rest hands codegen a literal that does not exist, and the pooling this loader does (config
   * tokens _plus_ the repo's CSS) puts both kinds in one list.
   */
  utilityIsClass?: boolean;
} & TokenRef;

/**
 * The literal codegen should emit for a token.
 *
 * A utility base (`primary-500`) leads only when the project has a utility framework **and** the
 * token came from a source that framework actually generates classes from — see
 * {@linkcode ProjectToken.utilityIsClass}. Otherwise the `var()` reference is the correct literal.
 * (`utility` still aids name-matching either way; that is a separate concern from this output.)
 *
 * Shared by the forward join and the design-context value annotation so the two can never disagree
 * about how a token is written.
 */
export const refOf = (token: ProjectToken, utilityFirst: boolean): string => {
  if (utilityFirst && token.utilityIsClass === true && token.utility !== undefined) {
    return token.utility;
  }
  // Narrowing walks the union in the order the arms are declared: a token with no `cssVar` came
  // from a source that declares none, which is either the utility-only arm or the SCSS one.
  if (token.cssVar !== undefined) return token.cssVar;
  return token.utility ?? token.scssVar;
};

// Tailwind v4 @theme namespaces → category. Ordered most-specific-first so "font-weight-" wins over
// "font-". The utility base is whatever follows the matched prefix.
const TW_NAMESPACES: ReadonlyArray<readonly [string, string]> = [
  ['color-', 'color'],
  ['font-weight-', 'font-weight'],
  ['font-', 'font-family'],
  ['text-', 'font-size'],
  ['tracking-', 'letter-spacing'],
  ['leading-', 'line-height'],
  ['spacing-', 'spacing'],
  ['radius-', 'radius'],
  ['shadow-', 'shadow'],
  ['breakpoint-', 'breakpoint'],
  ['container-', 'container'],
  ['blur-', 'blur'],
  ['aspect-', 'aspect'],
  ['ease-', 'ease'],
  ['animate-', 'animate'],
];

const deriveNamespace = (name: string): { utility?: string; category?: string } => {
  for (const [prefix, category] of TW_NAMESPACES) {
    if (name.startsWith(prefix)) return { utility: name.slice(prefix.length), category };
  }
  return {};
};

// Selectors that declare a token's base value rather than an override of it. `html` is included
// because plain-CSS projects routinely use it in place of `:root`, and `:host` because component
// libraries shipping a shadow-DOM build declare both (Pico writes `:host,:root`).
const BASE_SELECTOR = /(^|[\s,])(:root\b|:host\b|html\b)/i;

// At-rules that make everything inside them conditional. A `:root` nested in one is a responsive or
// theme *override*, not the base declaration — `@media (prefers-color-scheme: dark) { :root { … } }`
// is how a large share of real stylesheets ship their dark theme. `@layer` is deliberately absent:
// it scopes cascade priority without making its contents conditional, and `@layer base { :root { … } }`
// is an ordinary way to write base tokens.
const CONDITIONAL_AT_RULE = /^@(media|supports|container)\b/i;

/**
 * Rank a declaration by how well it represents the token's _primary_ value. Lower wins.
 *
 * This replaces the previous "later declarations win" rule, which was not a choice between values
 * so much as an accident of document order: in any stylesheet with a light and a dark theme, the
 * theme declared second overwrote the other, so half the project's real token values could never be
 * matched. Both are kept now (see {@linkcode parseCssCustomProperties}); this only decides which
 * one leads, and so which one a name-match or an override ref resolves to.
 */
const scopeRank = (scope: string, ancestors: readonly string[]): number => {
  const chain = [...ancestors, scope];
  // Tailwind v4's @theme is the project's declared token source, so it outranks a plain :root even
  // when :root comes later — the CSS a build emits from @theme is exactly those :root variables.
  if (chain.some(s => /^@theme\b/i.test(s))) return 0;
  if (BASE_SELECTOR.test(scope) && !ancestors.some(a => CONDITIONAL_AT_RULE.test(a))) return 1;
  return 2;
};

/**
 * Parse every `--name: value` custom property out of a CSS string.
 *
 * A name declared with different values in different blocks yields one token per distinct value — a
 * light and a dark theme both contribute, so the value-match join can recognise either. The same
 * name and value repeated across blocks collapses to one entry: leaving those duplicated would make
 * `token_map` report a token as ambiguous with itself.
 *
 * Order is by {@linkcode scopeRank}, then document order, so the first entry for a name is its base
 * declaration — what `bestNameMatch` and override refs resolve to. Pure — no filesystem.
 *
 * `scssSyntax` when the text came from a `.scss` file. The declarations are identical, but the
 * syntax around them is Sass: without it a `//` comment swallows the following declaration, and one
 * containing a `}` swallows the whole file.
 */
export const parseCssCustomProperties = (css: string, scssSyntax = false): ProjectToken[] => {
  const declarations = scanCustomProperties(css, scssSyntax)
    .map((decl, index) => ({ decl, index, rank: scopeRank(decl.scope, decl.ancestors) }))
    .toSorted((a, b) => a.rank - b.rank || a.index - b.index);

  // Whether a *name* generates a utility class, decided once per name rather than per declaration.
  // Rank 0 is scopeRank's `@theme` case, and `@theme` is the only CSS in which declaring a custom
  // property also generates a class: a stray `:root { --color-brand: … }`, which the repo-wide pool
  // is full of, yields `utility: 'brand'` that nothing turns into `bg-brand`.
  //
  // The property belongs to the name, not to one declaration of it. A `@theme` token with a dark
  // override (`@theme { --color-surface: #fff }` + `.dark { --color-surface: #0a0a0a }`) is kept as
  // two tokens so the value-match join can recognise either, and ranking each separately left the
  // dark one utility-less — `bg-surface` for the light value and `var(--color-surface)` for the
  // dark one, two contradictory refs for one token inside a single payload.
  const generatesClass = new Set(declarations.filter(d => d.rank === 0).map(d => d.decl.name));

  const seen = new Set<string>();
  const out: ProjectToken[] = [];
  for (const { decl } of declarations) {
    const key = `${decl.name}\u0000${decl.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const { utility, category } = deriveNamespace(decl.name);
    const utilityIsClass = generatesClass.has(decl.name);
    out.push({
      name: decl.name,
      value: decl.value,
      cssVar: `var(--${decl.name})`,
      ...(utility === undefined ? {} : { utility }),
      ...(category === undefined ? {} : { category }),
      ...(utilityIsClass ? { utilityIsClass } : {}),
    });
  }
  return out;
};

/**
 * Parse the module-level `$name: value` variables out of a SCSS string.
 *
 * `from` is the file's repo-relative path and is required rather than optional, because a SCSS
 * reference does not resolve without an `@use` naming that file — the caller cannot emit the ref
 * usefully without it. See {@linkcode ProjectToken}'s ref union.
 *
 * Variables declared **inside a rule** are dropped: Sass scopes them to that block, so referencing
 * one from a generated component is a compile error, not a style mismatch. A repeated name keeps
 * one entry per distinct value, exactly as the CSS parser does, so a light/dark pair declared
 * through `!default` overrides can still be recognised by value.
 *
 * No `utility` or `category` is derived. Those exist to name a _utility class_, and SCSS generates
 * none — attaching a namespace-shaped stem here would put a `bg-primary-500` back into circulation
 * on a project that has no such class.
 */
export const parseScssVariables = (scss: string, from: string): ProjectToken[] => {
  const seen = new Set<string>();
  const out: ProjectToken[] = [];
  for (const decl of scanScssVariables(scss)) {
    // Scoped to a rule — local to that block, so not referenceable from generated code.
    if (decl.scope !== '') continue;
    // Private to its module. Sass treats a leading `-` or `_` as private: the member is not
    // exported, `meta.module-variables()` does not list it, and `@use`-ing the file and naming it
    // is an error. Bootstrap's `$_luminance-list` is one — emitting it hands codegen a ref that
    // cannot resolve from any other file, which is the one thing this reader must never do.
    if (decl.name.startsWith('_') || decl.name.startsWith('-')) continue;
    const key = `${decl.name}\u0000${decl.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name: decl.name, value: decl.value, scssVar: `$${decl.name}`, from });
  }
  return out;
};
