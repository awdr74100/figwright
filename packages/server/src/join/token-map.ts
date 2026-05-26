import type { FigmaToken } from '../tokens/figma-tokens.js';
import type { ProjectToken } from '../tokens/tokens.js';
import { diceSimilarity, type MappingStatus } from './component-map.js';

// The token join: Figma variable → project design token. Name-match is the primary, framework-agnostic
// signal (normalized Figma "Primary/500" vs project "color-primary-500" / utility "primary-500"); an
// exact color value-match is a strong confirmation that survives naming drift. Value-match is limited
// to hex colors on purpose — Tailwind v4 defaults ship oklch() and Figma exports hex, so cross-space
// color matching (and unit-aware number matching) is deferred; those still fall back to name-match.
// Pure, like the component join, so it's unit-testable without Figma or the filesystem.

export interface TokenMapping {
  figmaName: string;
  figmaValue: FigmaToken['value'];
  figmaType: string;
  candidate?: {
    /** Project token name (custom property without `--`), e.g. "color-primary-500". */
    token: string;
    /** Recommended literal: the Tailwind utility base when present, else the CSS var reference. */
    ref: string;
    cssVar: string;
    utility?: string;
    confidence: number;
    /** Which signals agreed: name similarity and/or exact color value. */
    matchedBy: ('name' | 'value')[];
  };
  status: MappingStatus;
}

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Normalize a hex color for comparison: expand shorthand, drop a fully-opaque alpha, uppercase. */
const normHex = (raw: string): string | null => {
  const m = /^#([0-9a-fA-F]{3,8})$/.exec(raw.trim());
  if (m === null) return null;
  let h = m[1] ?? '';
  if (h.length === 3) h = [...h].map(c => c + c).join('');
  if (h.length === 8 && h.slice(6).toUpperCase() === 'FF') h = h.slice(0, 6);
  return `#${h.toUpperCase()}`;
};

/** The names a project token can be matched against: its Tailwind utility base and its raw name. */
const matchNames = (token: ProjectToken): string[] =>
  token.utility === undefined ? [token.name] : [token.utility, token.name];

interface NameMatch {
  token: ProjectToken;
  score: number;
}

const bestNameMatch = (
  figmaName: string,
  projectTokens: readonly ProjectToken[],
): NameMatch | null => {
  const target = norm(figmaName);
  let best: NameMatch | null = null;
  for (const token of projectTokens) {
    let score = 0;
    for (const name of matchNames(token))
      score = Math.max(score, diceSimilarity(target, norm(name)));
    if (best === null || score > best.score) best = { token, score };
  }
  return best;
};

const refOf = (token: ProjectToken): string => token.utility ?? token.cssVar;

const candidateFrom = (
  token: ProjectToken,
  confidence: number,
  matchedBy: ('name' | 'value')[],
): NonNullable<TokenMapping['candidate']> => ({
  token: token.name,
  ref: refOf(token),
  cssVar: token.cssVar,
  ...(token.utility === undefined ? {} : { utility: token.utility }),
  confidence: Number(confidence.toFixed(3)),
  matchedBy,
});

const statusFor = (confidence: number, threshold: number): MappingStatus => {
  if (confidence >= 0.85) return 'high';
  if (confidence >= threshold) return 'medium';
  if (confidence >= 0.5) return 'low';
  return 'unmapped';
};

export interface TokenJoinOptions {
  threshold: number;
}

const joinOne = (
  figma: FigmaToken,
  projectTokens: readonly ProjectToken[],
  opts: TokenJoinOptions,
): TokenMapping => {
  const base: TokenMapping = {
    figmaName: figma.name,
    figmaValue: figma.value,
    figmaType: figma.type,
    status: 'unmapped',
  };

  const nameMatch = bestNameMatch(figma.name, projectTokens);

  // Exact color value-match: strong, naming-independent evidence.
  const figmaHex = typeof figma.value === 'string' ? normHex(figma.value) : null;
  const valueMatch =
    figmaHex === null ? undefined : projectTokens.find(t => normHex(t.value) === figmaHex);

  if (valueMatch !== undefined) {
    const nameAgrees =
      nameMatch !== null && nameMatch.token === valueMatch && nameMatch.score >= 0.5;
    const confidence = nameAgrees ? 1 : 0.9;
    const matchedBy: ('name' | 'value')[] = nameAgrees ? ['name', 'value'] : ['value'];
    return {
      ...base,
      candidate: candidateFrom(valueMatch, confidence, matchedBy),
      status: statusFor(confidence, opts.threshold),
    };
  }

  if (nameMatch !== null && nameMatch.score >= 0.5) {
    return {
      ...base,
      candidate: candidateFrom(nameMatch.token, nameMatch.score, ['name']),
      status: statusFor(nameMatch.score, opts.threshold),
    };
  }

  return base;
};

/** Join every Figma token against the project's tokens; pure over its inputs. */
export const joinTokens = (
  figmaTokens: readonly FigmaToken[],
  projectTokens: readonly ProjectToken[],
  opts: TokenJoinOptions,
): TokenMapping[] => figmaTokens.map(t => joinOne(t, projectTokens, opts));
