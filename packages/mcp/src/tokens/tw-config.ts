// Tailwind v3 design tokens, read statically out of `tailwind.config.{js,cjs,mjs,ts}`.
//
// Why this exists: v3 keeps its scales in a JS object, not in CSS. `parseCssCustomProperties` — the
// only project-token source until now — therefore finds nothing on a v3 project, and token_map came
// back empty for the whole Tailwind v3 population. v4 moved the same scales into `@theme` custom
// properties, which is exactly why the CSS path covers v4 and not v3.
//
// Why static AST and not `import()`: this runs inside an MCP server that an agent can point at any
// directory, so evaluating a stranger's config would execute their code — and a `.ts` config would
// need a loader on top. Reading the object literal costs coverage (a config that computes its theme
// is partly unreadable), never correctness: anything that can't be evaluated by looking at it is
// skipped and counted, never guessed. Same robustness rule as `css-scan.ts` — this reads *other
// people's* repositories, so a malformed or exotic config must degrade, not throw.
//
// The output is deliberately the same vocabulary the v4 path emits: a v3 `theme.colors.primary[500]`
// and a v4 `--color-primary-500` both become name `color-primary-500` / utility `primary-500` /
// category `color`, so the join, the synonym tables and the built-in-scale fallback behave
// identically across the two versions and none of them had to learn about v3.
//
// The one thing v3 tokens do NOT have is a CSS custom property — v3 inlines theme values into the
// generated utilities, so there is no `var(--color-primary-500)` to reference. That is why
// `ProjectToken` models its reference forms as a union: these tokens are utility-only.

import { parseSync } from 'oxc-parser';

import type { ProjectToken } from './tokens.js';

/* eslint-disable @typescript-eslint/no-explicit-any -- oxc AST walker below, as in scan/scan.ts */

/**
 * V3 `theme` key → the v4 custom-property prefix and category it corresponds to. Ordered so the
 * emitted tokens are deterministic regardless of the order the config happens to declare them in.
 *
 * Only scales with an unambiguous v4 counterpart are here, and the omissions are the point: a v3
 * `theme.zIndex.modal` has no v4 namespace and no bare-base utility (the class is `z-modal`, not
 * `modal`), so emitting `modal` as a ref would hand codegen a literal that does not exist. Every
 * entry below is a scale whose _base name_ is the reusable token — the same contract v4's
 * `TW_NAMESPACES` already implies. Unmapped theme keys are dropped silently: `content`, `keyframes`
 * and friends appear in nearly every config and are not design tokens.
 *
 * `maxWidth` → `container-` is the one rename rather than a straight carry-over; v4 folded v3's
 * max-width scale into `--container-*`.
 */
const V3_NAMESPACES: ReadonlyArray<readonly [themeKey: string, prefix: string, category: string]> =
  [
    ['colors', 'color-', 'color'],
    ['spacing', 'spacing-', 'spacing'],
    ['fontSize', 'text-', 'font-size'],
    ['fontFamily', 'font-', 'font-family'],
    ['fontWeight', 'font-weight-', 'font-weight'],
    ['letterSpacing', 'tracking-', 'letter-spacing'],
    ['lineHeight', 'leading-', 'line-height'],
    ['borderRadius', 'radius-', 'radius'],
    ['boxShadow', 'shadow-', 'shadow'],
    ['screens', 'breakpoint-', 'breakpoint'],
    ['maxWidth', 'container-', 'container'],
    ['blur', 'blur-', 'blur'],
    ['aspectRatio', 'aspect-', 'aspect'],
    ['transitionTimingFunction', 'ease-', 'ease'],
    ['animation', 'animate-', 'animate'],
  ];

// Safety rails against a pathological or hostile config. Neither is reachable by a real Tailwind
// theme (the largest stock palette is ~250 entries, nested three deep).
const MAX_TOKENS = 2000;
const MAX_DEPTH = 8;
// Bounds the `const a = b; const b = a;` style identifier chase when resolving `export default cfg`.
const MAX_UNWRAP = 8;

export interface TailwindConfigTokens {
  tokens: ProjectToken[];
  /**
   * Theme entries inside a mapped scale that could not be evaluated by reading them — a spread of
   * an imported palette, a computed key, a function value, a template literal with an expression.
   * They are reported rather than guessed so the caller can say why a token it expected is
   * missing.
   */
  skipped: number;
}

const EMPTY: TailwindConfigTokens = { tokens: [], skipped: 0 };

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
 * A theme leaf's value as written. Arrays carry two different meanings in a Tailwind theme and both
 * are real: `fontFamily.sans: ['Inter', 'sans-serif']` is one font stack (join it, which is exactly
 * the CSS it compiles to, and what the v4 `--font-sans` custom property would hold), while
 * `fontSize.sm: ['0.875rem', { lineHeight: … }]` is a size plus its options (take the size — the
 * companion values are separate scales the design side tokenizes on their own). The two are told
 * apart by whether every element is a literal string.
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
 * Flatten one scale's object into (path, value) pairs. `DEFAULT` is Tailwind's "the key itself"
 * marker — `colors.primary.DEFAULT` is the `primary` token — so it drops off the end of the path.
 */
const flattenScale = (
  node: any,
  path: readonly string[],
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
      flattenScale(prop.value, next, out, onSkip, depth + 1);
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
 * Read a Tailwind v3 config's theme scales as project tokens.
 *
 * Both halves of the theme contribute: `theme` (which _replaces_ Tailwind's default scale) and
 * `theme.extend` (which merges on top of it), with `extend` winning a name collision exactly as
 * Tailwind resolves it. Pure and total — a config this can't parse yields no tokens, never an
 * exception, so a grounding call is never taken down by someone else's config file.
 */
export const parseTailwindConfig = (filePath: string, code: string): TailwindConfigTokens => {
  let program: any;
  try {
    program = parseSync(filePath, code).program;
  } catch {
    return EMPTY;
  }

  const config = findConfigObject(program);
  if (config === null) return EMPTY;
  // Every lookup goes through unwrapObject, not a bare type check, so a theme (or a single scale)
  // held in a local `const` — including the `{ theme }` shorthand — resolves like an inline literal.
  const theme = unwrapObject(propertyNamed(config, 'theme'), program);
  if (theme === null) return EMPTY;
  const extend = unwrapObject(propertyNamed(theme, 'extend'), program);

  let skipped = 0;
  const onSkip = (): void => {
    skipped += 1;
  };
  // Keyed by token name so `theme.extend` overwrites the base scale's entry for the same name,
  // matching Tailwind's own merge — and so one name can never be emitted twice, which the join
  // would otherwise read as a token ambiguous with itself.
  const byName = new Map<string, ProjectToken>();

  for (const [themeKey, prefix, category] of V3_NAMESPACES) {
    for (const scope of [theme, extend]) {
      const scale = scope === null ? null : unwrapObject(propertyNamed(scope, themeKey), program);
      if (scale === null) continue;
      flattenScale(
        scale,
        [],
        (path, value) => {
          if (byName.size >= MAX_TOKENS) return;
          const segments = path[path.length - 1] === 'DEFAULT' ? path.slice(0, -1) : path;
          // A scale's own DEFAULT (`borderRadius: { DEFAULT: '4px' }`) empties the path: the class
          // is the bare `rounded`, so there is no base name to emit and no var() to fall back on.
          // Dropping it costs one match (a Figma `rounded/default` reads unmapped) and is still the
          // right trade — the alternative is emitting `` or `radius-`, neither of which is a class.
          if (segments.length === 0) return;
          const utility = segments.join('-');
          byName.set(`${prefix}${utility}`, {
            name: `${prefix}${utility}`,
            value,
            utility,
            category,
          });
        },
        onSkip,
      );
    }
  }

  return { tokens: [...byName.values()], skipped };
};
