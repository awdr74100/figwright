import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { ProjectProfile } from '../profile/profile.js';
import { aggregateRepoCssTokens } from './repo-css.js';
import { parseCssCustomProperties, type ProjectToken } from './tokens.js';

// The one place that decides where a project's design tokens come from and reads them — shared by
// token_map (the explicit join tool) and the design-context value-reverse annotation, so the two
// surfaces can never disagree about what the project's tokens are.

/** Pick the CSS token source: explicit override, else the detected styling config when it's CSS. */
export const resolveTokenSource = (
  profile: ProjectProfile,
  override: string | undefined,
): { source: string | null; note?: string } => {
  if (override !== undefined) return { source: override };
  const configPath = profile.styling.configPath;
  if (configPath === undefined)
    return { source: null, note: 'no token source detected; pass tokenSource' };
  if (!configPath.endsWith('.css')) {
    return {
      source: null,
      note: `styling config ${configPath} is not CSS (Tailwind v3 JS config is not yet parsed); pass tokenSource to a CSS file`,
    };
  }
  return { source: configPath };
};

export interface LoadedProjectTokens {
  tokens: ProjectToken[];
  /** Repo-relative source that was actually read, or null (aggregated or none). */
  source: string | null;
  /** Diagnostic for the caller: why there's no single source / that a source failed to read. */
  note?: string;
  /** Repo-relative CSS files the tokens came from (the single source, or every contributor). */
  files: string[];
}

/**
 * Load the project's design tokens: the detected/overridden CSS source when there is one, else the
 * repo-wide custom-property aggregation (whose pool the joins filter — incidental vars never
 * surface on their own). Notes mirror what token_map has always reported.
 */
export const loadProjectTokens = async (
  rootDir: string,
  profile: ProjectProfile,
  tokenSourceOverride: string | undefined,
): Promise<LoadedProjectTokens> => {
  const { source, note } = resolveTokenSource(profile, tokenSourceOverride);
  if (source !== null) {
    try {
      const tokens = parseCssCustomProperties(await readFile(join(rootDir, source), 'utf8'));
      return { tokens, source, files: [source] };
    } catch {
      return {
        tokens: [],
        source: null,
        note: `token source ${source} could not be read`,
        files: [],
      };
    }
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
