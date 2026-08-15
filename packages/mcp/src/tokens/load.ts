import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { ProjectProfile } from '../profile/profile.js';
import { aggregateRepoCssTokens } from './repo-css.js';
import { parseCssCustomProperties, type ProjectToken } from './tokens.js';
import { parseTailwindConfig } from './tw-config.js';

// The one place that decides where a project's design tokens come from and reads them — shared by
// token_map (the explicit join tool) and the design-context value-reverse annotation, so the two
// surfaces can never disagree about what the project's tokens are.

/**
 * Which reader a token source needs. `css` covers Tailwind v4's `@theme` and plain custom
 * properties alike (both are CSS declarations); `tailwind-v3` is the JS/TS config object, which
 * holds the same scales in a form no CSS parser can see.
 */
export type TokenSourceKind = 'css' | 'tailwind-v3';

export interface TokenSource {
  /** Repo-relative path. */
  path: string;
  kind: TokenSourceKind;
}

// .js / .cjs / .mjs / .ts / .cts / .mts — every extension a Tailwind config is allowed to use.
const JS_CONFIG_EXT = /\.[cm]?[jt]s$/i;

/**
 * Pick the token source: explicit override, else the detected styling config. The reader is chosen
 * by extension, which is also how an override is honoured — pointing `tokenSource` at a config file
 * reads it as a config, at a stylesheet reads it as CSS.
 */
export const resolveTokenSource = (
  // Only the styling half of the profile decides this, so that's all it asks for.
  profile: Pick<ProjectProfile, 'styling'>,
  override: string | undefined,
): { source: TokenSource | null; note?: string } => {
  if (override !== undefined) {
    return {
      source: { path: override, kind: JS_CONFIG_EXT.test(override) ? 'tailwind-v3' : 'css' },
    };
  }
  const configPath = profile.styling.configPath;
  if (configPath === undefined)
    return { source: null, note: 'no token source detected; pass tokenSource' };
  if (configPath.endsWith('.css')) return { source: { path: configPath, kind: 'css' } };
  // The only non-CSS styling config detection reports is a Tailwind v3 JS/TS config.
  if (JS_CONFIG_EXT.test(configPath)) return { source: { path: configPath, kind: 'tailwind-v3' } };
  return {
    source: null,
    note: `styling config ${configPath} is not a readable token source; pass tokenSource`,
  };
};

export interface LoadedProjectTokens {
  tokens: ProjectToken[];
  /** Repo-relative source that was actually read, or null (aggregated or none). */
  source: string | null;
  /** Diagnostic for the caller: why there's no single source / that a source failed to read. */
  note?: string;
  /** Repo-relative files the tokens came from (the source, plus any aggregated contributors). */
  files: string[];
}

/** Read one file, or null when it isn't readable — a missing token source is a note, not a throw. */
const readOr = async (rootDir: string, rel: string): Promise<string | null> => {
  try {
    return await readFile(join(rootDir, rel), 'utf8');
  } catch {
    return null;
  }
};

/**
 * Load the project's design tokens: the detected/overridden source when there is one, else the
 * repo-wide custom-property aggregation (whose pool the joins filter — incidental vars never
 * surface on their own). Notes mirror what token_map has always reported.
 */
export const loadProjectTokens = async (
  rootDir: string,
  profile: ProjectProfile,
  tokenSourceOverride: string | undefined,
): Promise<LoadedProjectTokens> => {
  const { source, note } = resolveTokenSource(profile, tokenSourceOverride);

  if (source?.kind === 'tailwind-v3') return loadTailwindV3Tokens(rootDir, source.path);

  if (source !== null) {
    const body = await readOr(rootDir, source.path);
    if (body === null) {
      return {
        tokens: [],
        source: null,
        note: `token source ${source.path} could not be read`,
        files: [],
      };
    }
    return { tokens: parseCssCustomProperties(body), source: source.path, files: [source.path] };
  }

  // No single token config detected (a plain CSS-variables project, or Tailwind whose @theme entry
  // wasn't located). Aggregate custom properties across the repo's CSS and let the join filter
  // them — incidental vars stay unmatched, so this can only add real matches, never regress.
  const { tokens, files } = await aggregateRepoCssTokens(rootDir);
  if (files.length > 0) {
    return {
      tokens,
      source: null,
      note: `no single token config detected; aggregated ${tokens.length} custom properties from ${files.length} CSS file(s): ${files.join(', ')}`,
      files,
    };
  }
  return { tokens, source: null, ...(note === undefined ? {} : { note }), files };
};

/**
 * Tailwind v3: the config's theme scales **plus** the repo's CSS custom properties.
 *
 * The union is not a nicety, it's the no-regression condition. Before the config could be read, a
 * v3 project fell through to the repo-wide CSS aggregation, so any token it declared as a plain
 * custom property (`:root { --brand: … }` alongside the config — extremely common, since that's how
 * v3 projects do runtime theming) was already being matched. Reading the config _instead_ of that
 * pool would have traded one set of matches for another; reading it _in addition_ can only add.
 *
 * Config tokens lead: on a Tailwind project their utility base is the better ref, and the join
 * scores each name once in encounter order. A name+value present in both pools is emitted once, so
 * a token can never be reported ambiguous with itself; the same name at a _different_ value is kept
 * (two real declarations, exactly as a light/dark pair is kept within one stylesheet).
 */
const loadTailwindV3Tokens = async (
  rootDir: string,
  configPath: string,
): Promise<LoadedProjectTokens> => {
  const body = await readOr(rootDir, configPath);
  if (body === null) {
    return {
      tokens: [],
      source: null,
      note: `token source ${configPath} could not be read`,
      files: [],
    };
  }
  const config = parseTailwindConfig(configPath, body);
  const css = await aggregateRepoCssTokens(rootDir);

  const seen = new Set(config.tokens.map(t => `${t.name} ${t.value}`));
  const tokens = [...config.tokens];
  for (const token of css.tokens) {
    const key = `${token.name} ${token.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    tokens.push(token);
  }

  const notes = [`read ${config.tokens.length} theme token(s) from ${configPath}`];
  if (config.tokens.length === 0) {
    notes.push(
      'its theme could not be read statically (computed or imported); pass tokenSource to a CSS file if the tokens live there',
    );
  } else if (config.skipped > 0) {
    notes.push(
      `${config.skipped} theme entr(ies) were skipped because they are not statically readable (spread of an imported palette, computed key, or function value)`,
    );
  }
  if (css.files.length > 0) {
    notes.push(
      `also pooled ${css.tokens.length} CSS custom propert(ies) from ${css.files.length} file(s): ${css.files.join(', ')}`,
    );
  }
  // Tailwind v3 inlines theme values into its utilities, so these tokens have no var() form — the
  // ref a caller should emit is the utility base (bg-primary-500), not var(--color-primary-500).
  notes.push('Tailwind v3 declares no CSS custom properties; reference theme tokens as utilities');

  return {
    tokens,
    source: configPath,
    note: notes.join('; '),
    files: [configPath, ...css.files],
  };
};
