import { stat } from 'node:fs/promises';
import { join } from 'node:path';

import type {
  GetDesignContextResult,
  ProjectTokenAnnotation,
  ProjectTokenMatch,
} from '@figwright/shared';

import { analyzeProject, isUtilityFirst } from '../profile/profile.js';
import { normHex } from './hex.js';
import { loadProjectTokens } from './load.js';
import { type ProjectToken, refOf } from './tokens.js';

// The value-reverse join: project token value → name, pointed at the design context's raw colors.
// It exists for the files the forward join can't help — no variables bound (most real-world
// documents), so token_map has nothing to map and every color in the grounding payload is a raw
// hex. Annotating those hexes in the payload itself means the answer rides along with the data: a
// caller about to hardcode #6266F0 sees the project already names that color, without a separate
// tool call or a skill it may never read. Evidence is value-equality only, so the discipline from
// the forward join applies double: a unique match is a candidate (not an instruction), several
// same-value tokens are surfaced unranked, and more than a few is noise and omitted entirely.

/** Value index over the project's color tokens: normalized hex → the tokens declaring it. */
export type TokenValueIndex = ReadonlyMap<string, readonly ProjectToken[]>;

/**
 * Build the hex → tokens index. Only hex-valued tokens participate (the same deliberate limit as
 * the forward join's value-match); duplicate declarations of the same token name+value (e.g. one
 * custom property redeclared across aggregated CSS files) collapse so they can't fake ambiguity.
 */
export const buildTokenValueIndex = (tokens: readonly ProjectToken[]): TokenValueIndex => {
  const byHex = new Map<string, ProjectToken[]>();
  const seen = new Set<string>();
  for (const token of tokens) {
    const hex = normHex(token.value);
    if (hex === null) continue;
    const key = `${hex}\u0000${token.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const list = byHex.get(hex);
    if (list === undefined) byHex.set(hex, [token]);
    else list.push(token);
  }
  return byHex;
};

// Beyond this many same-value tokens the annotation is noise (think #FFFFFF in a large design
// system) — omit it entirely rather than shipping an unusable pile.
const MAX_CANDIDATES = 3;

const toMatch = (token: ProjectToken, utilityFirst: boolean): ProjectTokenMatch => ({
  ref: refOf(token, utilityFirst),
  name: token.name,
  // Carried for the same reason token_map carries it: a SCSS ref is an undefined-variable error
  // until the consuming file @uses this path, and this annotation is the surface a caller reads
  // when the document has no variables to join — the commoner case, not the rarer one.
  ...(token.from === undefined ? {} : { from: token.from }),
});

/** A string is hex-like when normHex accepts it — the only values the index can answer for. */
const HEX_SHAPE = /^#[0-9a-fA-F]{3,8}$/;

/** Collect every hex-shaped string in the payload, keyed exactly as written (verbatim lookup). */
const collectHexStrings = (value: unknown, out: Set<string>): void => {
  if (typeof value === 'string') {
    if (HEX_SHAPE.test(value.trim())) out.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectHexStrings(item, out);
    return;
  }
  if (typeof value === 'object' && value !== null) {
    for (const item of Object.values(value)) collectHexStrings(item, out);
  }
};

/**
 * Annotate a full design-context payload with the value-reverse join: every raw color string that
 * exactly matches project token value(s) lands in `projectTokens`, keyed verbatim so the caller can
 * look a color up as it reads it. Pure — returns the input untouched when nothing matches.
 */
export const annotateProjectTokens = (
  result: GetDesignContextResult,
  index: TokenValueIndex,
  utilityFirst: boolean,
): GetDesignContextResult => {
  if (index.size === 0) return result;

  const found = new Set<string>();
  collectHexStrings(result.nodes, found);
  if (result.globalVars !== undefined) collectHexStrings(result.globalVars, found);

  const annotations: Record<string, ProjectTokenAnnotation> = {};
  for (const raw of found) {
    const hex = normHex(raw);
    if (hex === null) continue;
    const tokens = index.get(hex);
    if (tokens === undefined || tokens.length > MAX_CANDIDATES) continue;
    // matchedBy: ['value'] on every entry — the weak-evidence marker (same vocabulary as
    // token_map), so no entry ever reads as a resolved binding.
    if (tokens.length === 1) {
      annotations[raw] = {
        ...toMatch(tokens[0] as ProjectToken, utilityFirst),
        matchedBy: ['value'],
      };
    } else {
      const candidates = tokens
        .map(t => toMatch(t, utilityFirst))
        .toSorted((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      annotations[raw] = { matchedBy: ['value'], candidates };
    }
  }

  if (Object.keys(annotations).length === 0) return result;
  return { ...result, projectTokens: annotations };
};

interface CachedIndex {
  index: TokenValueIndex;
  utilityFirst: boolean;
  /** Absolute path → mtimeMs of every file the tokens came from, for cheap invalidation. */
  fileMtimes: ReadonlyMap<string, number>;
  builtAt: number;
}

// Cache freshness: recorded-file mtimes are re-stat'ed on every hit (an edit invalidates
// immediately); a *new* CSS file only enters the pool on the next full rebuild, so entries also
// expire on a TTL. Grounding calls cluster within a session, so almost every call hits the cache.
const CACHE_TTL_MS = 60_000;

const cache = new Map<string, CachedIndex>();

const mtimesUnchanged = async (fileMtimes: ReadonlyMap<string, number>): Promise<boolean> => {
  const checks = await Promise.all(
    [...fileMtimes].map(async ([path, mtimeMs]) => {
      try {
        return (await stat(path)).mtimeMs === mtimeMs;
      } catch {
        return false;
      }
    }),
  );
  return checks.every(Boolean);
};

/**
 * The IO half: detect the profile, load the project tokens (same loader token_map uses), build the
 * value index, and cache it per rootDir. Never throws — grounding must not fail because the CSS
 * side hiccuped; on any error the annotation simply doesn't happen.
 */
export const loadTokenValueIndex = async (
  rootDir: string,
): Promise<{ index: TokenValueIndex; utilityFirst: boolean }> => {
  const now = Date.now();
  const hit = cache.get(rootDir);
  if (
    hit !== undefined &&
    now - hit.builtAt < CACHE_TTL_MS &&
    (await mtimesUnchanged(hit.fileMtimes))
  ) {
    return { index: hit.index, utilityFirst: hit.utilityFirst };
  }

  try {
    const profile = await analyzeProject(rootDir);
    const loaded = await loadProjectTokens(rootDir, profile, undefined);
    const index = buildTokenValueIndex(loaded.tokens);
    const utilityFirst = isUtilityFirst(profile.styling.system);

    const fileMtimes = new Map<string, number>();
    await Promise.all(
      loaded.files.map(async rel => {
        const abs = join(rootDir, rel);
        try {
          fileMtimes.set(abs, (await stat(abs)).mtimeMs);
        } catch {
          // A file that vanished between read and stat simply won't gate the cache.
        }
      }),
    );

    cache.set(rootDir, { index, utilityFirst, fileMtimes, builtAt: now });
    return { index, utilityFirst };
  } catch {
    return { index: new Map(), utilityFirst: false };
  }
};
