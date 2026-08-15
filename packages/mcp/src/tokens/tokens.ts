// Project token parser — the right-hand side of the token join. Reads design tokens out of the
// project's CSS: every `--name: value` declaration. This covers both Tailwind v4 (CSS-first @theme
// block) and plain CSS custom properties (:root), which is why token_map's first cut targets those
// two. Tailwind v3's JS config (theme.colors etc.) needs evaluating/AST-parsing JS and is deferred.
// For v4, the @theme namespaces (--color-*, --spacing-*, …) map to utility base names, so the join
// can suggest `primary-500` (a Tailwind utility) and not just the raw custom property.
//
// Delimiting the declarations is `css-scan.ts`; everything here is the token-level meaning built on
// top of them — the Tailwind namespace derivation, and which block's value leads for a given name.

import { scanCustomProperties } from './css-scan.js';

/**
 * How a project token can be referenced in generated code. Which forms exist is a property of the
 * _source_, not of the individual token:
 *
 * - Every CSS source (Tailwind v4 `@theme`, plain `:root` custom properties) declares a custom
 *   property, so `cssVar` is always there; `utility` is derived from the name's namespace when it
 *   has one.
 * - A Tailwind v3 JS config declares no custom property at all — v3 inlines theme values into the
 *   utilities it generates — so those tokens are utility-only.
 *
 * Modelled as a union rather than two independent optionals so that {@linkcode refOf} is total by
 * construction: a token with neither reference form is not representable, and the compiler proves
 * it. Reaching for `token.name` as a last-resort ref would be exactly the failure this guards — a
 * bare name is not a usable literal in any styling system.
 */
type TokenRef = { cssVar: string; utility?: string } | { cssVar?: undefined; utility: string };

export type ProjectToken = {
  /** Token name; for a CSS source, the custom property without `--`, e.g. "color-primary-500". */
  name: string;
  /** Raw declared value as written, e.g. "#6266F0", "oklch(0.6 0.2 270)", "0.875rem". */
  value: string;
  /** Tailwind token category derived from the namespace, e.g. "color"; absent for plain CSS vars. */
  category?: string;
} & TokenRef;

/**
 * The literal codegen should emit for a token.
 *
 * A utility base (primary-500) is only a real, usable class on a project whose framework generates
 * one — `utility` is derived purely from the name's prefix and so is populated even on projects
 * with no such framework (where it's just the name minus a category prefix, and no `primary-500`
 * class exists). So the utility only leads when `utilityFirst` says the project has that
 * vocabulary; otherwise the `var()` reference is the correct literal. (`utility` still aids
 * name-matching either way — that's a separate concern from this output.)
 *
 * Shared by the forward join and the design-context value annotation so the two can never disagree
 * about how a token is written.
 */
export const refOf = (token: ProjectToken, utilityFirst: boolean): string => {
  if (utilityFirst && token.utility !== undefined) return token.utility;
  // Narrowing on the union: no `cssVar` means the token came from a source that declares none,
  // which is the arm that guarantees a `utility`.
  return token.cssVar === undefined ? token.utility : token.cssVar;
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
 */
export const parseCssCustomProperties = (css: string): ProjectToken[] => {
  const declarations = scanCustomProperties(css)
    .map((decl, index) => ({ decl, index, rank: scopeRank(decl.scope, decl.ancestors) }))
    .toSorted((a, b) => a.rank - b.rank || a.index - b.index);

  const seen = new Set<string>();
  const out: ProjectToken[] = [];
  for (const { decl } of declarations) {
    const key = `${decl.name}\u0000${decl.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const { utility, category } = deriveNamespace(decl.name);
    out.push({
      name: decl.name,
      value: decl.value,
      cssVar: `var(--${decl.name})`,
      ...(utility === undefined ? {} : { utility }),
      ...(category === undefined ? {} : { category }),
    });
  }
  return out;
};
