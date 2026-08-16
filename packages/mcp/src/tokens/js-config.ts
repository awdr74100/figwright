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
  /**
   * Whether an array value is one value written in parts (a font stack) rather than a value plus
   * its options. Only the font-family scales are; everything else that accepts an array uses it for
   * `[value, …options]`, and Tailwind documents `fontSize: { sm: ['0.875rem', '1.25rem'] }` — a
   * size and a line-height — which joined into "0.875rem, 1.25rem" and could then match nothing.
   */
  joinArray?: boolean;
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
  { key: 'fontFamily', prefix: 'font-', category: 'font-family', joinArray: true },
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
  { key: 'font', prefix: 'font-', category: 'font-family', joinArray: true },
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
   * Mapped theme entries — or whole mapped scales — that could not be evaluated by reading them: a
   * spread of an imported palette, a computed key, a function value, a template literal with an
   * expression, or a scale assigned from something this cannot see through. Reported rather than
   * guessed, so the caller can say why a token someone expected is missing. Counting only entries
   * _inside_ a scale left the loudest case silent: `colors: require('tailwindcss/colors')` drops a
   * whole palette while the note still reads "read N theme token(s)".
   */
  skipped: number;
}

/** Nothing was reachable — no config object, or no `theme` on it. */
const NO_THEME: JsConfigTokens = { tokens: [], skipped: 0, themeFound: false };

/** What a framework needs in order to choose which scale table its config speaks. */
interface ScalePickContext {
  config: any;
  program: any;
  /** The `theme` object and its `extend`, either of which may be null. */
  scopes: readonly any[];
}

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
 * ['0.875rem', …]` is a size plus its options (take the size — the companions are separate scales
 * the design side tokenizes on their own).
 *
 * Which one it is comes from the **scale**, not from the array's shape. Telling them apart by
 * "every element is a literal string" looked equivalent and was not: Tailwind documents `fontSize:
 * { sm: ['0.875rem', '1.25rem'] }` — size and line-height, both strings — which joined into
 * "0.875rem, 1.25rem", a value that can never match Figma's 14px and, if the name matched anyway,
 * was reported as a candidate carrying garbage. A silently wrong read, not a counted skip.
 *
 * Taking element 0 also truncates a stack that ends in something unreadable — Nuxt UI's real config
 * writes `sans: ['DM Sans', ...defaultTheme.fontFamily.sans]`, which yields "DM Sans". That is the
 * primary family, which is what a Figma font token actually names, so the partial read is still the
 * useful one; dropping the token would lose a match the design side can make.
 */
const leafValue = (node: any, joinArray = false): string | null => {
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
    // A stack is joined only when it is complete; a spread or a computed entry truncates it, and
    // half a font stack read as CSS would be wrong where the primary family alone is useful.
    if (joinArray) {
      return parts.length === (node.elements?.length ?? 0)
        ? parts.join(', ')
        : (parts[0] as string);
    }
    return parts[0] as string;
  }
  return null;
};

/**
 * Reduce an expression to the object literal it stands for: `satisfies Config` / `as Config`
 * wrappers, and an identifier pointing at a `const config = { … }` in the same file (the shape
 * almost every TypeScript config uses). Returns null when the value is built somewhere this can't
 * see — imported, spread, computed.
 *
 * `allowCall` unwraps a single-object-argument call to that argument, and is passed **only** at the
 * config level, for `defineConfig({ … })`. It must not reach a theme scale: `colors: withOpacity({
 * primary: '#6266F0' })` would then read the function's _input_ as the resolved palette, and a
 * function wrapping a scale exists precisely to transform it (that one usually emits `rgb(var(--x)
 * / <alpha-value>)`). The name would survive but the value would be whatever went in, which is a
 * guess — and this reader's contract is that it skips what it cannot evaluate rather than
 * guessing.
 */
const unwrapObject = (node: any, program: any, allowCall = false, depth = 0): any => {
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
      return unwrapObject(node.expression, program, allowCall, depth + 1);
    case 'CallExpression': {
      if (!allowCall) return null;
      const arg = node.arguments?.find((a: any) => a?.type === 'ObjectExpression');
      return arg === undefined ? null : unwrapObject(arg, program, allowCall, depth + 1);
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
            return unwrapObject(d.init, program, allowCall, depth + 1);
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
      const obj = unwrapObject(stmt.declaration, program, true);
      if (obj !== null) return obj;
    }
    if (stmt?.type === 'ExpressionStatement' && stmt.expression?.type === 'AssignmentExpression') {
      const left = stmt.expression.left;
      const isModuleExports =
        left?.type === 'MemberExpression' &&
        left.object?.name === 'module' &&
        left.property?.name === 'exports';
      if (isModuleExports || left?.name === 'exports') {
        const obj = unwrapObject(stmt.expression.right, program, true);
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
      if (scale.leafKey !== undefined) {
        // This scale's leaves ARE option objects: the object is the terminus, not a nesting level.
        // Falling through to the recursive walk when the sub-key is missing would flatten the other
        // options into names — a wind4 `text: { sm: { lineHeight } }` (every field of that entry is
        // optional in UnoCSS's own type) became `text-sm-lineHeight`, which is not a class. Skip
        // and count instead: an entry this scale can't read is unreadable, not deeper.
        const inner = propertyNamed(prop.value, scale.leafKey);
        const innerValue = inner === null ? null : leafValue(inner);
        if (innerValue === null) onSkip();
        else out(next, innerValue);
        continue;
      }
      flattenScale(prop.value, next, scale, out, onSkip, depth + 1);
      continue;
    }
    const value = leafValue(prop.value, scale.joinArray === true);
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
  pickScales: (ctx: ScalePickContext) => readonly Scale[],
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

  let skipped = 0;
  const onSkip = (): void => {
    skipped += 1;
  };

  const declaredExtend = propertyNamed(theme, 'extend');
  const extend = unwrapObject(declaredExtend, program);
  // An `extend` that is declared but unreadable (`extend: mkTheme({ … })`) is the whole of most
  // configs' theme. Left uncounted, a config with everything inside it reported "its theme declares
  // no scales that map to design tokens" — which is the opposite of true, and points the reader
  // away from the one thing that went wrong.
  if (declaredExtend !== null && extend === null) onSkip();
  // Keyed by token name so `theme.extend` overwrites the base scale's entry for the same name,
  // matching the frameworks' own merge — and so one name can never be emitted twice, which the join
  // would otherwise read as a token ambiguous with itself.
  const byName = new Map<string, ProjectToken>();
  // Scales already reported unreadable. A config can declare the same one in both `theme` and
  // `theme.extend`, and counting each declaration would say "2 entries skipped" for one missing
  // palette — the number exists to tell someone how much is gone, not how many ways it is gone.
  const reportedUnreadable = new Set<string>();

  for (const scale of pickScales({ config, program, scopes: [theme, extend] })) {
    for (const scope of [theme, extend]) {
      const declared = scope === null ? null : propertyNamed(scope, scale.key);
      const source = declared === null ? null : unwrapObject(declared, program);
      if (source === null) {
        // A scale that is *declared* but unreadable — `colors: require('tailwindcss/colors')`, or a
        // function of the theme — counts as skipped. It is the single commonest unreadable shape
        // and the loudest: a whole palette goes missing. Counting only unreadable entries *inside*
        // a scale meant the note said "read 3 theme token(s)" with no hint that colours were gone.
        if (declared !== null && !reportedUnreadable.has(scale.key)) {
          reportedUnreadable.add(scale.key);
          onSkip();
        }
        continue;
      }
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
            // A scale declared in the framework's own config is exactly what it generates classes from.
            utilityIsClass: true,
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
 * Keys that appear in one scale table but still exist in the other vocabulary's theme under a
 * different _shape_, so their presence proves nothing. `container` is the whole list: a scale in
 * wind4, an options object (`{ center, padding }`) in wind3 and Tailwind alike. Counting it as a
 * wind4 marker flipped a wind3 config whose presets happened to be unreadable, and then read those
 * options as tokens — `container-padding`, whose ref composes to `max-w-padding`.
 *
 * Every other difference between the two tables is a genuine marker: wind3's theme has no `text`,
 * `font`, `radius`, `shadow`, `tracking`, `leading`, `breakpoint` or `ease` key (it spells them
 * `fontSize`, `fontFamily`, `borderRadius`, `boxShadow`, `letterSpacing`, `lineHeight`,
 * `breakpoints`, `easing`), and wind4's has none of those longer spellings.
 */
const AMBIGUOUS_KEYS: ReadonlySet<string> = new Set(['container']);

/**
 * Whether a preset reference carries a theme vocabulary at all. `presetIcons`, `presetAttributify`,
 * `presetTypography` and friends add rules without one, so they cannot answer which vocabulary the
 * theme speaks — and counting them as an answer disabled the key-shape fallback entirely: `presets:
 * [presetIcons(), ...sharedPresets]` on a wind4 theme was ruled wind3 and dropped every wind4-only
 * scale, silently.
 */
const isVocabularyPreset = (name: string, from: string | undefined): boolean =>
  /(wind|uno|mini)/i.test(name) || /preset-(wind|uno|mini)/i.test(from ?? '');

/** Theme keys that belong to exactly one UnoCSS vocabulary, so their presence identifies it. */
const discriminators = (mine: readonly Scale[], other: readonly Scale[]): readonly Scale[] =>
  mine.filter(s => !AMBIGUOUS_KEYS.has(s.key) && !other.some(o => o.key === s.key));

const wind4Only = discriminators(UNO_WIND4_SCALES, UNO_WIND3_SCALES);
const wind3Only = discriminators(UNO_WIND3_SCALES, UNO_WIND4_SCALES);

/** How many of a scale set's keys the theme (or its `extend`) actually declares. */
const declaredCount = (scopes: readonly any[], scales: readonly Scale[]): number =>
  scales.filter(s => scopes.some(scope => scope !== null && propertyNamed(scope, s.key) !== null))
    .length;

/**
 * Which UnoCSS theme vocabulary a config speaks. The two are incompatible (see
 * {@linkcode UNO_WIND4_SCALES}), so this cannot be skipped by merging the tables.
 *
 * `presets` is authoritative when it can be read. When it can't — `presets: sharedPresets`, a
 * spread, a helper — the theme's own key set decides, because the vocabularies are largely
 * disjoint: `radius`/`text`/`shadow` belong to wind4 alone, `borderRadius`/`fontSize`/`boxShadow`
 * to wind3 alone. That is evidence, not a guess, and it closes the case where a genuine wind4
 * config was read with the wind3 table and quietly lost every wind4-only scale with `skipped` still
 * at zero. Ties and no-evidence both fall to wind3: `presetUno` re-exports it, and it is the
 * long-standing vocabulary.
 */
const unoScalesFor = ({ config, program, scopes }: ScalePickContext): readonly Scale[] => {
  // Local binding name → the module it was imported from, so a preset can be identified by what it
  // *is* rather than by what it happens to be called. Reading only the callee name missed every
  // renamed import (`import w4 from '@unocss/preset-wind4'`) — silently, since wind4's keys are
  // absent from the wind3 table and the result was simply empty. Scanning the file's imports for
  // the string instead would over-fire: a config that imports both presets, or imports one it does
  // not end up using, would be misread. Only what the `presets` array actually references counts.
  // Both halves of an import matter. A default import carries its identity in the module specifier
  // (`import w4 from '@unocss/preset-wind4'`); a named one carries it in the imported name, since
  // the specifier is just the umbrella package (`import { presetWind4 as wind } from 'unocss'`).
  const bindings = new Map<string, { from: string; imported: string }>();
  for (const stmt of program?.body ?? []) {
    if (stmt?.type !== 'ImportDeclaration' || typeof stmt.source?.value !== 'string') continue;
    for (const spec of stmt.specifiers ?? []) {
      const local = spec?.local?.name;
      if (typeof local !== 'string') continue;
      const imported = typeof spec.imported?.name === 'string' ? spec.imported.name : local;
      bindings.set(local, { from: stmt.source.value, imported });
    }
  }

  const presets = propertyNamed(config, 'presets');
  let identified = false;
  for (const el of presets?.elements ?? []) {
    const name = el?.type === 'CallExpression' ? el.callee?.name : el?.name;
    if (typeof name !== 'string') continue;
    const binding = bindings.get(name);
    if (!isVocabularyPreset(name, binding?.from)) continue;
    identified = true;
    if (
      /wind4/i.test(name) ||
      /wind4/i.test(binding?.imported ?? '') ||
      /preset-wind4/i.test(binding?.from ?? '')
    ) {
      return UNO_WIND4_SCALES;
    }
  }
  // A readable vocabulary preset that is not wind4 has answered the question — it is wind3. Only
  // when none could be read (`presets: sharedPresets`, a spread, a helper) does the theme's own
  // shape get a say; otherwise a plain `presetUno()` config would be re-judged by its keys, and
  // `container` — an options object there, a scale in wind4 — would flip it.
  if (identified) return UNO_WIND3_SCALES;
  return declaredCount(scopes, wind4Only) > declaredCount(scopes, wind3Only)
    ? UNO_WIND4_SCALES
    : UNO_WIND3_SCALES;
};

/** Read a `uno.config.*` / `unocss.config.*`, in whichever preset vocabulary it declares. */
export const parseUnoConfig = (filePath: string, code: string): JsConfigTokens =>
  readThemeScales(filePath, code, unoScalesFor);
