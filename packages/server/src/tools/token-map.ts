import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { GetVariableDefsResult } from '@figwright/shared';
import { z } from 'zod';

import { joinTokens, type TokenMapping } from '../join/token-map.js';
import { analyzeProject, type ProjectProfile } from '../profile/profile.js';
import { resolveFigmaTokens } from '../tokens/figma-tokens.js';
import { aggregateRepoCssTokens } from '../tokens/repo-css.js';
import { parseCssCustomProperties } from '../tokens/tokens.js';
import { GET_VARIABLE_DEFS_TOOL_NAME } from './get-variable-defs.js';
import type { ToolSpec } from './spec.js';

export const TOKEN_MAP_TOOL_NAME = 'token_map';

const DEFAULT_THRESHOLD = 0.7;

const inputShape = {
  rootDir: z.string().describe('Project root; defaults to the server cwd').optional(),
  tokenSource: z
    .string()
    .describe('Path (relative to rootDir) to a CSS file holding the tokens; overrides detection')
    .optional(),
  threshold: z
    .number()
    .min(0)
    .max(1)
    .describe('Confidence at/above which a match counts as reliable (default 0.7)')
    .optional(),
};

export interface TokenMapResult {
  mappings: TokenMapping[];
  /** Figma token names with no project token candidate ≥ 0.5 — the gap to define. */
  unmapped: string[];
  profile: ProjectProfile;
  /** Repo-relative token source that was parsed, or null when none was usable. */
  tokenSource: string | null;
  projectTokenCount: number;
  /** Set when the token source couldn't be used (e.g. a Tailwind v3 JS config). */
  note?: string;
}

export const tokenMapTool: ToolSpec = {
  name: TOKEN_MAP_TOOL_NAME,
  description:
    "Map the document's Figma variables to the project's design tokens, so generated code references " +
    'existing tokens instead of hard-coded values. Joins the grounded Figma variable names + values ' +
    'against tokens parsed from the project CSS (Tailwind v4 @theme or :root custom properties); the ' +
    'match is name-based with an exact color value-match as confirmation. On a Tailwind project a ' +
    'variable that hits a framework built-in scale (spacing/N, line-height/N, weight/*) is reported as ' +
    "status 'framework-builtin' with { builtin: { scale, step } } rather than unmapped — it has no " +
    '@theme token but the utility (p-4 / gap-4, leading-7, font-bold) is still usable. tokenSource ' +
    'overrides the ' +
    'detected styling config; rootDir defaults to the server cwd. Tailwind v3 JS configs are not yet ' +
    'parsed (pass tokenSource to a CSS file). Returns { mappings (candidate + confidence + status + ' +
    'matchedBy + builtin), unmapped, tokenSource, profile }.',
  inputShape,
  kind: 'local',
};
export type ToolDispatcher = (toolName: string, args: unknown) => Promise<unknown>;

/** Pick the CSS token source: explicit override, else the detected styling config when it's CSS. */
const resolveTokenSource = (
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

/**
 * Orchestrate the token join: pull the document's variables (reusing get_variable_defs — no
 * dedicated plugin handler), detect the project profile, parse its CSS token source, and join.
 * Filesystem + dispatch live here; the matching itself is pure (join/token-map.ts).
 */
export const handleTokenMap = async (
  dispatch: ToolDispatcher,
  rawArgs: unknown,
): Promise<TokenMapResult> => {
  const args = z.object(inputShape).parse(rawArgs);
  const rootDir = args.rootDir ?? process.cwd();
  const threshold = args.threshold ?? DEFAULT_THRESHOLD;

  const [defs, profile] = await Promise.all([
    dispatch(GET_VARIABLE_DEFS_TOOL_NAME, {}) as Promise<GetVariableDefsResult>,
    analyzeProject(rootDir),
  ]);

  const { source, note } = resolveTokenSource(profile, args.tokenSource);
  let projectTokens: ReturnType<typeof parseCssCustomProperties> = [];
  let usedSource: string | null = null;
  let aggregateNote: string | undefined;
  if (source !== null) {
    try {
      projectTokens = parseCssCustomProperties(await readFile(join(rootDir, source), 'utf8'));
      usedSource = source;
    } catch {
      // fall through with empty tokens + the note below
    }
  } else {
    // No single token config detected (a plain CSS-variables project, or Tailwind whose @theme entry
    // wasn't located). Aggregate custom properties across the repo's CSS and let the join filter
    // them — incidental vars stay unmatched, so this can only add real matches, never regress.
    const { tokens, files } = await aggregateRepoCssTokens(rootDir);
    projectTokens = tokens;
    if (files.length > 0) {
      aggregateNote = `no single token config detected; aggregated ${tokens.length} custom properties from ${files.length} CSS file(s): ${files.join(', ')}`;
    }
  }

  const figmaTokens = resolveFigmaTokens(defs);
  const mappings = joinTokens(figmaTokens, projectTokens, {
    threshold,
    tailwind: profile.styling.system === 'tailwind',
  });
  const unmapped = mappings.filter(m => m.status === 'unmapped').map(m => m.figmaName);

  const readNote =
    source !== null && usedSource === null
      ? `token source ${source} could not be read`
      : (aggregateNote ?? note);

  return {
    mappings,
    unmapped,
    profile,
    tokenSource: usedSource,
    projectTokenCount: projectTokens.length,
    ...(readNote === undefined ? {} : { note: readNote }),
  };
};
