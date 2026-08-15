// Design tokens read statically out of a utility-framework JS/TS config — `tailwind.config.*` and
// `uno.config.*` / `unocss.config.*`.
//
// Why this exists: both frameworks can keep their scales in a JS object rather than in CSS, and
// `parseCssCustomProperties` — the only project-token source before this — finds nothing there. A
// Tailwind v3 project and any UnoCSS project therefore joined against an empty pool. (Tailwind v4
// moved the same scales into `@theme` custom properties, which is why the CSS path covers it.)
//
// Why static AST and not `import()`: this runs inside an MCP server that an agent can point at any
// directory, so evaluating a stranger's config would execute their code — and a `.ts` config would
// need a loader on top. Reading the object literal costs coverage (a config that computes its theme
// is partly unreadable), never correctness: anything that can't be evaluated by looking at it is
// skipped and counted, never guessed. Same robustness rule as `css-scan.ts` — this reads *other
// people's* repositories, so a malformed or exotic config must degrade, not throw.
//
// Output is deliberately one vocabulary, the one Tailwind v4's `@theme` uses: a v3
// `theme.colors.primary[500]`, a v4 `--color-primary-500` and a UnoCSS `theme.colors.primary[500]`
// all become name `color-primary-500` / utility `primary-500` / category `color`. The join, the
// synonym tables and the built-in-scale fallback needed no knowledge of any of them.
//
// What differs between frameworks is only *which theme key holds which scale*, so that is the sole
// thing the tables below encode. The three vocabularies were each verified by generating CSS from a
// real installed framework rather than read off documentation — see the scale tables for what that
// turned up, notably that UnoCSS is two vocabularies, not one.
//
// These tokens have no CSS custom property — both frameworks inline theme values into the utilities
// they generate — which is why `ProjectToken` models its reference forms as a union: utility-only.

import { parseSync } from 'oxc-parser';

import type { ProjectToken } from './tokens.js';

/* eslint-disable @typescript-eslint/no-explicit-any -- oxc AST walker below, as in scan/scan.ts */

/** One theme scale: where the config keeps it, and what the emitted token is called. */
interface Scale {
  /** The `theme` key holding the scale. */
  key: string;
  /** Prefix the token name gets — the Tailwind v4 custom-property namespace. */
  prefix: string;
  /** Token category, e.g. "color". */
  category: string;
  /**
   * For a scale whose leaves are objects rather than strings, the sub-key holding the value. Only
   * UnoCSS's wind4 `text` needs it: `text: { sm: { fontSize, lineHeight, letterSpacing } }`, where
   * descending blindly would emit `text-sm-fontSize`, a name for nothing.
   */
  leafKey?: string;
}

// Scales that Tailwind v3 and UnoCSS's Tailwind-v3-compatible presets (wind3, and `presetUno`,
// which is a re-export of it) name identically. Only scales whose *base name* is the reusable token
// are here, and the omissions are the point: `zIndex.modal` has no bare-base utility (the class is
// `z-modal`, not `modal`), so emitting `modal` as a ref would hand codegen a literal that does not
// exist. Unmapped keys are dropped silently — `content`, `keyframes` and friends are in nearly
// every config and are not design tokens.
//
// `maxWidth` → `container-` is the one rename rather than a straight carry-over; Tailwind v4 folded
// the v3 max-width scale into `--container-*`.
const V3_SHARED_SCALES: readonly Scale[] = [
  { key: 'colors', prefix: 'color-', category: 'color' },
  { key: 'spacing', prefix: 'spacing-', category: 'spacing' },
  { key: 'fontSize', prefix: 'text-', category: 'font-size' },
  { key: 'fontFamily', prefix: 'font-', category: 'font-family' },
  { key: 'fontWeight', prefix: 'font-weight-', category: 'font-weight' },
  { key: 'letterSpacing', prefix: 'tracking-', category: 'letter-spacing' },
  { key: 'lineHeight', prefix: 'leading-', category: 'line-height' },
  { key: 'borderRadius', prefix: 'radius-', category: 'radius' },
  { key: 'boxShadow', prefix: 'shadow-', category: 'shadow' },
  { key: 'maxWidth', prefix: 'container-', category: 'container' },
  { key: 'blur', prefix: 'blur-', category: 'blur' },
];

const TAILWIND_V3_SCALES: readonly Scale[] = [
  ...V3_SHARED_SCALES,
  { key: 'screens', prefix: 'breakpoint-', category: 'breakpoint' },
  { key: 'transitionTimingFunction', prefix: 'ease-', category: 'ease' },
  { key: 'aspectRatio', prefix: 'aspect-', category: 'aspect' },
  { key: 'animation', prefix: 'animate-', category: 'animate' },
];

// UnoCSS's wind3-era theme is Tailwind v3's with four differences, every one of them confirmed by
// generating CSS from an installed UnoCSS rather than assumed from the family resemblance:
// `breakpoints` not `screens`, `easing` not `transitionTimingFunction`, no `aspectRatio` at all,
// and `animation` is a structured object (keyframes / durations / timingFns), not a flat scale —
// walking it would emit `animate-keyframes-*`, which is a name for nothing.
const UNO_WIND3_SCALES: readonly Scale[] = [
  ...V3_SHARED_SCALES,
  { key: 'breakpoints', prefix: 'breakpoint-', category: 'breakpoint' },
  { key: 'easing', prefix: 'ease-', category: 'ease' },
];

// UnoCSS's wind4 preset is a different vocabulary again — Tailwind *v4*'s namespace names used as
// theme keys, so it is nearly the identity mapping onto what this module emits. Confirmed the same
// way (generated CSS): `text`/`radius`/`shadow`/`tracking`/`leading`/`breakpoint`/`container`/
// `ease`/`font` all drive utilities. `animate` does not on its own (it needs a matching keyframes
// entry), so it is left out rather than offered as a ref that may not resolve.
//
// `container` is the reason the two UnoCSS vocabularies cannot simply be merged into one table: in
// wind3 (and Tailwind v3) `container` is a structured `{ center, padding, screens }` options object,
// so reading it as a scale would emit `container-center` and `container-padding`.
const UNO_WIND4_SCALES: readonly Scale[] = [
  { key: 'colors', prefix: 'color-', category: 'color' },
  { key: 'spacing', prefix: 'spacing-', category: 'spacing' },
  { key: 'text', prefix: 'text-', category: 'font-size', leafKey: 'fontSize' },
  { key: 'font', prefix: 'font-', category: 'font-family' },
  { key: 'fontWeight', prefix: 'font-weight-', category: 'font-weight' },
  { key: 'tracking', prefix: 'tracking-', category: 'letter-spacing' },
  { key: 'leading', prefix: 'leading-', category: 'line-height' },
  { key: 'radius', prefix: 'radius-', category: 'radius' },
  { key: 'shadow', prefix: 'shadow-', category: 'shadow' },
  { key: 'breakpoint', prefix: 'breakpoint-', category: 'breakpoint' },
  { key: 'container', prefix: 'container-', category: 'container' },
  { key: 'blur', prefix: 'blur-', category: 'blur' },
  { key: 'ease', prefix: 'ease-', category: 'ease' },
];

// Safety rails against a pathological or hostile config. Neither is reachable by a real theme (the
// largest stock palette is ~250 entries, nested three deep).
const MAX_TOKENS = 2000;
const MAX_DEPTH = 8;
// Bounds the `const a = b; const b = a;` style identifier chase when resolving `export default cfg`.
const MAX_UNWRAP = 8;

export interface JsConfigTokens {
  tokens: ProjectToken[];
  /**
   * Whether a `theme` object was located at all. Zero tokens means two very different things and
   * the caller has to tell a user which: a config whose theme this could not reach (built at
   * runtime, or living in a `presets` entry / shared package it never opens — the majority shape in
   * a monorepo) versus one that was read fine and simply declares no scales this maps (`theme: {
   * extend: {} }` is extremely common). Reporting the first message for the second case sends
   * someone hunting for a parsing problem that isn't there.
   */
  themeFound: boolean;
  /**
   * Theme entries inside a mapped scale that could not be evaluated by reading them — a spread of
   * an imported palette, a computed key, a function value, a template literal with an expression.
   * They are reported rather than guessed so the caller can say why a token it expected is
   * missing.
   */
  skipped: number;
}

/** Nothing was reachable — no config object, or no `theme` on it. */
const NO_THEME: JsConfigTokens = { tokens: [], skipped: 0, themeFound: false };

/** An object property key that can be read literally: `primary`, `'4.5'`, `500`. */
const keyName = (node: any): string | null => {
  if (node?.type === 'Identifier' && typeof node.name === 'string') return node.name;
  if (node?.type === 'Literal') {
    const { value } = node;
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return String(value);
  }
  return null;
};

/**
 * A theme leaf's value as written. Arrays carry two different meanings in a theme and both are
 * real: `fontFamily.sans: ['Inter', 'sans-serif']` is one font stack (join it, which is exactly the
 * CSS it compiles to, and what a v4 `--font-sans` custom property would hold), while `fontSize.sm:
 * ['0.875rem', { lineHeight: … }]` is a size plus its options (take the size — the companion values
 * are separate scales the design side tokenizes on their own). The two are told apart by whether
 * every element is a literal string.
 *
 * The same rule truncates a stack that ends in something unreadable — Nuxt UI's real config writes
 * `sans: ['DM Sans', ...defaultTheme.fontFamily.sans]`, which yields "DM Sans". That is the primary
 * family, which is what a Figma font token actually names, so the partial read is still the useful
 * one; the alternative (dropping the token) would lose a match the design side can make.
 */
const leafValue = (node: any): string | null => {
  if (node?.type === 'Literal') {
    const { value } = node;
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return String(value);
    return null;
  }
  // A template literal with no interpolation is just a string written with backticks.
  if (node?.type === 'TemplateLiteral' && (node.expressions?.length ?? 0) === 0) {
    const cooked = node.quasis?.[0]?.value?.cooked;
    return typeof cooked === 'string' ? cooked : null;
  }
  if (node?.type === 'ArrayExpression') {
    const parts: string[] = [];
    for (const el of node.elements ?? []) {
      if (el?.type !== 'Literal' || typeof el.value !== 'string') break;
      parts.push(el.value);
    }
    if (parts.length === 0) return null;
    return parts.length === (node.elements?.length ?? 0) ? parts.join(', ') : (parts[0] as string);
  }
  return null;
};

/**
 * Reduce an expression to the object literal it stands for: `satisfies Config` / `as Config`
 * wrappers, a `defineConfig({ … })` call, and an identifier pointing at a `const config = { … }` in
 * the same file (the shape almost every TypeScript config uses). Returns null when the config is
 * built somewhere this can't see — imported, spread, computed.
 */
const unwrapObject = (node: any, program: any, depth = 0): any => {
  if (node == null || depth > MAX_UNWRAP) return null;
  switch (node.type) {
    case 'ObjectExpression':
      return node;
    case 'TSAsExpression':
    case 'TSSatisfiesExpression':
    case 'TSNonNullExpression':
    // The angle-bracket cast — `export default <Partial<Config>>{ … }`, which is what Nuxt UI's own
    // config uses. Handling only `as`/`satisfies` silently dropped the entire config.
    case 'TSTypeAssertion':
      return unwrapObject(node.expression, program, depth + 1);
    case 'CallExpression': {
      // defineConfig({ … }) and any other single-object-argument wrapper.
      const arg = node.arguments?.find((a: any) => a?.type === 'ObjectExpression');
      return arg === undefined ? null : unwrapObject(arg, program, depth + 1);
    }
    case 'Identifier': {
      for (const stmt of program.body ?? []) {
        const decl =
          stmt?.type === 'VariableDeclaration'
            ? stmt
            : stmt?.type === 'ExportNamedDeclaration' &&
                stmt.declaration?.type === 'VariableDeclaration'
              ? stmt.declaration
              : null;
        for (const d of decl?.declarations ?? []) {
          if (d?.id?.type === 'Identifier' && d.id.name === node.name && d.init != null) {
            return unwrapObject(d.init, program, depth + 1);
          }
        }
      }
      return null;
    }
    default:
      return null;
  }
};

/** The exported config object: `export default …`, `module.exports = …`, or `exports = …`. */
const findConfigObject = (program: any): any => {
  for (const stmt of program.body ?? []) {
    if (stmt?.type === 'ExportDefaultDeclaration') {
      const obj = unwrapObject(stmt.declaration, program);
      if (obj !== null) return obj;
    }
    if (stmt?.type === 'ExpressionStatement' && stmt.expression?.type === 'AssignmentExpression') {
      const left = stmt.expression.left;
      const isModuleExports =
        left?.type === 'MemberExpression' &&
        left.object?.name === 'module' &&
        left.property?.name === 'exports';
      if (isModuleExports || left?.name === 'exports') {
        const obj = unwrapObject(stmt.expression.right, program);
        if (obj !== null) return obj;
      }
    }
  }
  return null;
};

const propertyNamed = (obj: any, name: string): any => {
  for (const prop of obj?.properties ?? []) {
    if (prop?.type === 'Property' && prop.computed !== true && keyName(prop.key) === name) {
      return prop.value;
    }
  }
  return null;
};

/**
 * Flatten one scale's object into (path, value) pairs. `DEFAULT` is the "the key itself" marker in
 * both frameworks — `colors.primary.DEFAULT` is the `primary` token — so it drops off the path in
 * the caller.
 */
const flattenScale = (
  node: any,
  path: readonly string[],
  scale: Scale,
  out: (path: readonly string[], value: string) => void,
  onSkip: () => void,
  depth = 0,
): void => {
  if (depth > MAX_DEPTH) {
    onSkip();
    return;
  }
  for (const prop of node?.properties ?? []) {
    if (prop?.type !== 'Property' || prop.computed === true) {
      // A SpreadElement (`...require('tailwindcss/colors')`) or a computed key: real theme entries
      // this can't read. Counted once, since how many it hides is exactly what isn't knowable.
      onSkip();
      continue;
    }
    const key = keyName(prop.key);
    if (key === null) {
      onSkip();
      continue;
    }
    const next = [...path, key];
    if (prop.value?.type === 'ObjectExpression') {
      // A scale whose leaves are option objects stops here, at the sub-key that holds the value.
      const inner = scale.leafKey === undefined ? null : propertyNamed(prop.value, scale.leafKey);
      const innerValue = inner === null ? null : leafValue(inner);
      if (innerValue !== null) {
        out(next, innerValue);
        continue;
      }
      flattenScale(prop.value, next, scale, out, onSkip, depth + 1);
      continue;
    }
    const value = leafValue(prop.value);
    if (value === null) {
      onSkip();
      continue;
    }
    out(next, value);
  }
};

/**
 * Read a config's theme scales as project tokens, given the vocabulary its framework uses.
 *
 * Both halves of the theme contribute: `theme` (which _replaces_ the framework's default scale) and
 * `theme.extend` (which merges on top of it), with `extend` winning a name collision exactly as the
 * frameworks resolve it. Pure and total — a config this can't parse yields no tokens, never an
 * exception, so a grounding call is never taken down by someone else's config file.
 */
const readThemeScales = (
  filePath: string,
  code: string,
  pickScales: (config: any) => readonly Scale[],
): JsConfigTokens => {
  let program: any;
  try {
    program = parseSync(filePath, code).program;
  } catch {
    return NO_THEME;
  }

  const config = findConfigObject(program);
  if (config === null) return NO_THEME;
  // Every lookup goes through unwrapObject, not a bare type check, so a theme (or a single scale)
  // held in a local `const` — including the `{ theme }` shorthand — resolves like an inline literal.
  const theme = unwrapObject(propertyNamed(config, 'theme'), program);
  if (theme === null) return NO_THEME;
  const extend = unwrapObject(propertyNamed(theme, 'extend'), program);

  let skipped = 0;
  const onSkip = (): void => {
    skipped += 1;
  };
  // Keyed by token name so `theme.extend` overwrites the base scale's entry for the same name,
  // matching the frameworks' own merge — and so one name can never be emitted twice, which the join
  // would otherwise read as a token ambiguous with itself.
  const byName = new Map<string, ProjectToken>();

  for (const scale of pickScales(config)) {
    for (const scope of [theme, extend]) {
      const source = scope === null ? null : unwrapObject(propertyNamed(scope, scale.key), program);
      if (source === null) continue;
      flattenScale(
        source,
        [],
        scale,
        (path, value) => {
          if (byName.size >= MAX_TOKENS) return;
          const segments = path[path.length - 1] === 'DEFAULT' ? path.slice(0, -1) : path;
          // A scale's own DEFAULT (`borderRadius: { DEFAULT: '4px' }`) empties the path: the class
          // is the bare `rounded`, so there is no base name to emit and no var() to fall back on.
          // Dropping it costs one match (a Figma `rounded/default` reads unmapped) and is still the
          // right trade — the alternative is emitting `` or `radius-`, neither of which is a class.
          if (segments.length === 0) return;
          const utility = segments.join('-');
          byName.set(`${scale.prefix}${utility}`, {
            name: `${scale.prefix}${utility}`,
            value,
            utility,
            category: scale.category,
          });
        },
        onSkip,
      );
    }
  }

  return { tokens: [...byName.values()], skipped, themeFound: true };
};

/** Read a `tailwind.config.*` (v3 — v4 keeps its scales in CSS, which the CSS path already reads). */
export const parseTailwindConfig = (filePath: string, code: string): JsConfigTokens =>
  readThemeScales(filePath, code, () => TAILWIND_V3_SCALES);

/**
 * Which UnoCSS theme vocabulary a config speaks, read off its `presets`. The two are incompatible
 * (see {@linkcode UNO_WIND4_SCALES}), so this cannot be skipped by merging the tables. wind3 is the
 * default when the presets can't be read: `presetUno` re-exports it, and a config whose presets
 * come from elsewhere is far likelier to be on the long-standing vocabulary than the new one.
 */
const unoScalesFor = (config: any): readonly Scale[] => {
  const presets = propertyNamed(config, 'presets');
  for (const el of presets?.elements ?? []) {
    const name = el?.type === 'CallExpression' ? el.callee?.name : el?.name;
    if (typeof name === 'string' && /wind4/i.test(name)) return UNO_WIND4_SCALES;
  }
  return UNO_WIND3_SCALES;
};

/** Read a `uno.config.*` / `unocss.config.*`, in whichever preset vocabulary it declares. */
export const parseUnoConfig = (filePath: string, code: string): JsConfigTokens =>
  readThemeScales(filePath, code, unoScalesFor);
