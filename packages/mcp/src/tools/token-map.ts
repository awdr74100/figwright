import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { GetStylesResult, GetVariableDefsResult } from '@figwright/shared';
import { z } from 'zod';

import { joinTokens, parseTokenMapFile, type TokenMapping } from '../join/token-map.js';
import { analyzeProject, isUtilityFirst, type ProjectProfile } from '../profile/profile.js';
import { resolveFigmaTokens, resolvePaintStyleTokens } from '../tokens/figma-tokens.js';
import { loadProjectTokens } from '../tokens/load.js';
import { GET_STYLES_TOOL_NAME } from './get-styles.js';
import { GET_VARIABLE_DEFS_TOOL_NAME } from './get-variable-defs.js';
import type { ToolSpec } from './spec.js';

export const TOKEN_MAP_TOOL_NAME = 'token_map';

const DEFAULT_THRESHOLD = 0.7;
const MAP_FILE = 'docs/figma-token-map.md';

const readOverrides = async (rootDir: string): Promise<ReturnType<typeof parseTokenMapFile>> => {
  try {
    return parseTokenMapFile(await readFile(join(rootDir, MAP_FILE), 'utf8'));
  } catch {
    return new Map();
  }
};

const inputSchema = z.object({
  rootDir: z.string().describe('Project root; defaults to the server cwd').optional(),
  tokenSource: z
    .string()
    .describe(
      'Path (relative to rootDir) to the file holding the tokens — a CSS file, a .scss file, or a ' +
        'Tailwind / UnoCSS config (.js/.cjs/.mjs/.ts), read according to its name; overrides detection',
    )
    .optional(),
  threshold: z
    .number()
    .min(0)
    .max(1)
    .describe('Confidence at/above which a match counts as reliable (default 0.7)')
    .optional(),
});

export interface TokenMapResult {
  mappings: TokenMapping[];
  /** Figma token names with no project token candidate ≥ 0.5 — the gap to define. */
  unmapped: string[];
  /**
   * The file's theme axes: every variable collection with more than one mode (e.g. Light/Dark),
   * with its mode names and default. Mappings whose variable actually changes per mode carry the
   * per-theme values on figmaModes; this is the file-level summary that says themes exist at all.
   */
  themedCollections: { name: string; modes: string[]; defaultMode: string }[];
  profile: ProjectProfile;
  /** Repo-relative token source that was parsed, or null when none was usable. */
  tokenSource: string | null;
  projectTokenCount: number;
  /**
   * Docs/figma-token-map.md rows whose recorded ref no longer resolves to a project token
   * (renamed/removed). The mapping degraded to the normal join; re-record or remove the row.
   * Present only when at least one row is stale.
   */
  staleOverrides?: { figmaName: string; ref: string }[];
  /**
   * How the token pool was assembled, when that isn't just "read the detected source": which files
   * were aggregated, how much of a Tailwind config could not be read statically, or why no source
   * was usable at all.
   */
  note?: string;
}

export const tokenMapTool: ToolSpec = {
  name: TOKEN_MAP_TOOL_NAME,
  description:
    "Map the document's Figma variables — and its shared paint styles (single solid color styles, " +
    "the design-token mechanism of pre-variables files; such rows carry source: 'style') — to the " +
    "project's design tokens, so generated code references " +
    'existing tokens instead of hard-coded values. Joins the grounded Figma names + values ' +
    "against the project's design tokens — parsed from its CSS (Tailwind v4 @theme or :root custom " +
    'properties), on a Tailwind v3 or UnoCSS project from the theme scales in its JS/TS config ' +
    '(whose tokens have no var() form: reference them by candidate.ref, the utility base), and on a ' +
    'SCSS project from its $variables. A SCSS candidate carries candidate.from, the file declaring ' +
    'it: candidate.ref does NOT resolve on its own — the consuming file must @use that file, and ' +
    "how it is written decides the ref's final form (`@use '<from>' as *` keeps $name; a plain " +
    "`@use './tokens'` makes it tokens.$name). Emitting the ref without the import is a compile " +
    'error. The ' +
    'match is name-based with an exact color value-match as confirmation. When several project ' +
    'tokens share the exact same color value and the name cannot pick one, the mapping is capped ' +
    "below 'high' and candidate.ambiguousWith lists the other same-value tokens — verify that pick " +
    'semantically instead of trusting it blindly. On a project with a utility framework (Tailwind ' +
    'or UnoCSS) a ' +
    'variable that hits a framework built-in scale (spacing/N, line-height/N, weight/*) is reported as ' +
    "status 'framework-builtin' with { builtin: { scale, step } } rather than unmapped — it has no " +
    '@theme token but the utility (p-4 / gap-4, leading-7, font-bold) is still usable. A variable in ' +
    'a multi-mode collection whose value differs per mode (a Light/Dark theme) carries figmaModes ' +
    '(mode name → value per theme; figmaValue is only the default mode), and the result lists ' +
    'themedCollections — keep such tokens theme-aware (a token that itself switches per theme, or ' +
    "the non-default values wired through the project's dark-mode mechanism), never just the " +
    'default-mode literal. tokenSource ' +
    'overrides the ' +
    'detected styling config; rootDir defaults to the server cwd. A JS-config theme built at ' +
    'runtime (spread from an imported palette, computed, or living in a preset) is only partly ' +
    'readable — the note says how much was skipped or whether the theme was reachable at all, and ' +
    'the project CSS is pooled alongside it either way. ' +
    'An explicit docs/figma-token-map.md row ' +
    '(FigmaName | ref) overrides the fuzzy join with matchedBy ["map-file"] — this file is the ' +
    'durable record a verified token mapping is written back to, so the next run reuses it instead ' +
    'of re-guessing an ambiguous or value-only match. A row whose ref no longer resolves to a ' +
    'project token is reported in staleOverrides and degrades to the normal join. Returns { mappings ' +
    '(candidate + confidence + status + matchedBy + builtin), unmapped, staleOverrides, tokenSource, ' +
    'profile }.',
  inputSchema,
  kind: 'local',
};
export type ToolDispatcher = (toolName: string, args: unknown) => Promise<unknown>;

/**
 * Orchestrate the token join: pull the document's variables (reusing get_variable_defs — no
 * dedicated plugin handler), detect the project profile, load its design tokens (tokens/load.ts,
 * shared with the design-context value annotation), and join. Filesystem + dispatch live here; the
 * matching itself is pure (join/token-map.ts).
 */
export const handleTokenMap = async (
  dispatch: ToolDispatcher,
  rawArgs: unknown,
): Promise<TokenMapResult> => {
  const args = inputSchema.parse(rawArgs);
  const rootDir = args.rootDir ?? process.cwd();
  const threshold = args.threshold ?? DEFAULT_THRESHOLD;

  // Styles are an additive source, not a requirement: a get_styles failure must not take down the
  // variable join that succeeded before styles existed — degrade to variables-only instead.
  const [defs, styles, profile, overrides] = await Promise.all([
    dispatch(GET_VARIABLE_DEFS_TOOL_NAME, {}) as Promise<GetVariableDefsResult>,
    (dispatch(GET_STYLES_TOOL_NAME, {}) as Promise<GetStylesResult>).catch((): GetStylesResult => ({
      paints: [],
      texts: [],
      effects: [],
      grids: [],
    })),
    analyzeProject(rootDir),
    readOverrides(rootDir),
  ]);

  const loaded = await loadProjectTokens(rootDir, profile, args.tokenSource);

  // Variables first, then paint-style pseudo-tokens: a pre-variables file (palette carried as
  // shared paint styles, zero variables) joins too instead of coming back empty.
  const figmaTokens = [...resolveFigmaTokens(defs), ...resolvePaintStyleTokens(styles.paints)];
  const mappings = joinTokens(figmaTokens, loaded.tokens, {
    threshold,
    utilityFirst: isUtilityFirst(profile.styling.system),
    ...(overrides.size > 0 ? { overrides } : {}),
  });
  const unmapped = mappings.filter(m => m.status === 'unmapped').map(m => m.figmaName);
  // Stale rows (recorded ref no longer resolves) that degraded to the normal join — surfaced so the
  // caller can re-record or delete them, keeping the map file self-healing.
  const staleOverrides = mappings.flatMap(m =>
    m.staleOverride === undefined ? [] : [{ figmaName: m.figmaName, ref: m.staleOverride.ref }],
  );
  const themedCollections = defs.collections
    .filter(c => c.modes.length > 1)
    .map(c => ({
      name: c.name,
      modes: c.modes.map(m => m.name),
      defaultMode: c.modes.find(m => m.modeId === c.defaultModeId)?.name ?? c.modes[0]?.name ?? '',
    }));

  return {
    mappings,
    unmapped,
    themedCollections,
    profile,
    tokenSource: loaded.source,
    projectTokenCount: loaded.tokens.length,
    ...(staleOverrides.length > 0 ? { staleOverrides } : {}),
    ...(loaded.note === undefined ? {} : { note: loaded.note }),
  };
};
