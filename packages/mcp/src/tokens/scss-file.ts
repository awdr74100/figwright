import { scanCustomProperties } from './css-scan.js';
import {
  isBaseScopedDeclaration,
  parseCssCustomProperties,
  parseScssVariables,
  type ProjectToken,
} from './tokens.js';

// One `.scss` file's design tokens. Both kinds of declaration count, because modern SCSS projects
// use both and reading one would leave half the project joining against nothing:
//
//   - `$name: value` — a Sass variable, whose reference needs an `@use` of this file.
//   - `:root { --name: value }` — a real CSS custom property, which compiles through untouched, so
//     `var(--name)` resolves with no import at all.
//
// The reason this is per-file rather than per-repo is the *mirror*, which is the idiomatic modern
// layout and the reason both are read:
//
//     $brand: #6266F0;
//     :root { --brand: #{$brand}; }
//
// That is one logical token with two reference forms. Recognising it needs both halves of one file
// at once — the custom property's value is the literal text `#{$brand}`, which matches nothing
// until it is resolved against the variable declared beside it. Doing this repo-wide instead was
// wrong twice over: it never fired for the interpolated form (the values differ as text), and it
// let a `--x` in some unrelated stylesheet displace a genuinely declared `$x` from another file.

/** `#{$name}` — a custom property whose whole value is one interpolated variable. */
const SOLE_INTERPOLATION = /^#\{\s*\$([\w-]+)\s*\}$/;

/**
 * Read one `.scss` file's tokens, collapsing a mirrored declaration into the reference a caller can
 * use with the least ceremony.
 *
 * Where both forms exist for one token the custom property wins: `var(--brand)` compiles from any
 * consumer with no import, while `$brand` needs an `@use` resolved against the consuming file.
 * Preferring the self-sufficient ref is the point of having a choice.
 */
export const parseScssFile = (body: string, from: string): ProjectToken[] => {
  const variables = parseScssVariables(body, from);
  const byName = new Map(variables.map(v => [v.name, v.value]));

  const customProperties = parseCssCustomProperties(body, true);
  for (const token of customProperties) {
    // `--brand: #{$brand}` is the mirror's usual spelling. Resolved against this file's own
    // variables it becomes the value it actually compiles to, which is both what the value-match
    // join needs and what makes the pair recognisable as one token.
    const sole = SOLE_INTERPOLATION.exec(token.value);
    const resolved = sole === null ? undefined : byName.get(sole[1] as string);
    if (resolved !== undefined) token.value = resolved;
  }

  // A variable is dropped only when *this file* also exposes it as a custom property of the same
  // value — the mirror. A same-named variable in another file is a different declaration and is
  // not affected by what this one happens to expose.
  // Only a custom property that applies document-wide may displace the variable. One declared
  // under `.theme` resolves to nothing outside that selector, while the `$brand` it would have
  // replaced is referenceable anywhere through `@use` — trading them there loses the only usable
  // ref, which is the opposite of the rule this file states.
  const baseScoped = new Set(
    scanCustomProperties(body, true)
      .filter(d => isBaseScopedDeclaration(d.scope, d.ancestors))
      .map(d => d.name),
  );
  const mirrored = new Set(
    customProperties.filter(t => baseScoped.has(t.name)).map(t => `${t.name}\u0000${t.value}`),
  );
  const kept = [
    ...variables.filter(v => !mirrored.has(`${v.name}\u0000${v.value}`)),
    ...customProperties,
  ];

  // Resolving `#{$brand}` happens *after* parseCssCustomProperties has already deduped on
  // name+value, so it can newly make two entries identical — `--brand: #{$brand}` in `:root`
  // and a literal `--brand: #6266F0` in a theme class are one token once the interpolation is
  // resolved. Left duplicated they make the join report the token ambiguous with itself, which
  // is the failure this file exists to prevent.
  const seen = new Set<string>();
  return kept.filter(t => {
    const key = [t.name, t.value, t.cssVar ?? '', t.scssVar ?? '', t.from ?? ''].join('\u0000');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
