// Project token parser — the right-hand side of the token join. Reads design tokens out of the
// project's CSS: every `--name: value` declaration. This covers both Tailwind v4 (CSS-first @theme
// block) and plain CSS custom properties (:root), which is why token_map's first cut targets those
// two. Tailwind v3's JS config (theme.colors etc.) needs evaluating/AST-parsing JS and is deferred.
// For v4, the @theme namespaces (--color-*, --spacing-*, …) map to utility base names, so the join
// can suggest `primary-500` (a Tailwind utility) and not just the raw custom property.

export interface ProjectToken {
  /** Custom property name without the leading `--`, e.g. "color-primary-500". */
  name: string;
  /** Raw declared value as written, e.g. "#6266F0", "oklch(0.6 0.2 270)", "0.875rem". */
  value: string;
  /** CSS reference literal, e.g. "var(--color-primary-500)". */
  cssVar: string;
  /** Tailwind v4 utility base (namespace stripped), e.g. "primary-500"; absent for plain CSS vars. */
  utility?: string;
  /** Tailwind v4 token category derived from the namespace, e.g. "color"; absent for plain CSS vars. */
  category?: string;
}

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

const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

const CUSTOM_PROP = /--([a-zA-Z0-9-]+)\s*:\s*([^;]+);/g;

/**
 * Parse every `--name: value` custom property out of a CSS string. Later declarations win (a token
 * redefined in @theme after :root takes the @theme value). Pure — no filesystem.
 */
export const parseCssCustomProperties = (css: string): ProjectToken[] => {
  const body = stripComments(css);
  const byName = new Map<string, ProjectToken>();
  for (const match of body.matchAll(CUSTOM_PROP)) {
    const name = match[1];
    const value = match[2]?.trim();
    if (name === undefined || value === undefined || value.length === 0) continue;
    const { utility, category } = deriveNamespace(name);
    byName.set(name, {
      name,
      value,
      cssVar: `var(--${name})`,
      ...(utility === undefined ? {} : { utility }),
      ...(category === undefined ? {} : { category }),
    });
  }
  return [...byName.values()];
};
