import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { GetVariableDefsResult } from '@figma-mcp-relay/shared';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import * as v from 'valibot';

import { joinTokens, type TokenMapping } from '../join/token-map.js';
import { analyzeProject, type ProjectProfile } from '../profile/profile.js';
import { resolveFigmaTokens } from '../tokens/figma-tokens.js';
import { parseCssCustomProperties } from '../tokens/tokens.js';
import { GET_VARIABLE_DEFS_TOOL_NAME } from './get-variable-defs.js';

export const TOKEN_MAP_TOOL_NAME = 'token_map';

const DEFAULT_THRESHOLD = 0.7;

export const TokenMapInputSchema = v.object({
  rootDir: v.optional(v.string()),
  tokenSource: v.optional(v.string()),
  threshold: v.optional(v.pipe(v.number(), v.minValue(0), v.maxValue(1))),
});
export type TokenMapInput = v.InferOutput<typeof TokenMapInputSchema>;

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

export const tokenMapToolDefinition: Tool = {
  name: TOKEN_MAP_TOOL_NAME,
  description:
    "Map the document's Figma variables to the project's design tokens, so generated code references " +
    'existing tokens instead of hard-coded values. Joins the grounded Figma variable names + values ' +
    'against tokens parsed from the project CSS (Tailwind v4 @theme or :root custom properties); the ' +
    'match is name-based with an exact color value-match as confirmation. tokenSource overrides the ' +
    'detected styling config; rootDir defaults to the server cwd. Tailwind v3 JS configs are not yet ' +
    'parsed (pass tokenSource to a CSS file). Returns { mappings (candidate + confidence + status + ' +
    'matchedBy), unmapped, tokenSource, profile }.',
  inputSchema: {
    type: 'object',
    properties: {
      rootDir: { type: 'string', description: 'Project root; defaults to the server cwd' },
      tokenSource: {
        type: 'string',
        description:
          'Path (relative to rootDir) to a CSS file holding the tokens; overrides detection',
      },
      threshold: {
        type: 'number',
        minimum: 0,
        maximum: 1,
        description: 'Confidence at/above which a match counts as reliable (default 0.7)',
      },
    },
    additionalProperties: false,
  },
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
  const args = v.parse(TokenMapInputSchema, rawArgs);
  const rootDir = args.rootDir ?? process.cwd();
  const threshold = args.threshold ?? DEFAULT_THRESHOLD;

  const [defs, profile] = await Promise.all([
    dispatch(GET_VARIABLE_DEFS_TOOL_NAME, {}) as Promise<GetVariableDefsResult>,
    analyzeProject(rootDir),
  ]);

  const { source, note } = resolveTokenSource(profile, args.tokenSource);
  let projectTokens: ReturnType<typeof parseCssCustomProperties> = [];
  let usedSource: string | null = null;
  if (source !== null) {
    try {
      projectTokens = parseCssCustomProperties(await readFile(join(rootDir, source), 'utf8'));
      usedSource = source;
    } catch {
      // fall through with empty tokens + the note below
    }
  }

  const figmaTokens = resolveFigmaTokens(defs);
  const mappings = joinTokens(figmaTokens, projectTokens, { threshold });
  const unmapped = mappings.filter(m => m.status === 'unmapped').map(m => m.figmaName);

  const readNote =
    source !== null && usedSource === null ? `token source ${source} could not be read` : note;

  return {
    mappings,
    unmapped,
    profile,
    tokenSource: usedSource,
    projectTokenCount: projectTokens.length,
    ...(readNote === undefined ? {} : { note: readNote }),
  };
};
