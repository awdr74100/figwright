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

// Scale-aware name matching. A numbered/sized token splits into a stem and a *step*: "Primary/500" →
// (primary, 500), "spacing/24" → (spacing, 24), "rounded/lg" → (rounded, lg). The step is a hard key,
// not a fuzzy tail — otherwise the family prefix dominates Dice and every step in a family snaps to
// whatever step the project happens to define (Primary/50 → primary-500 @0.94, spacing/24 → spacing-2).
// So stems are fuzzy-matched but steps must be equal (or both absent) for a name match to count.
const SCALE_WORDS = new Set([
  'xs',
  'sm',
  'md',
  'lg',
  'xl',
  'base',
  'full',
  'default',
  'none',
  'px',
]);
const isScaleStep = (seg: string): boolean => /^\d/.test(seg) || SCALE_WORDS.has(seg);

interface Scaled {
  stem: string;
  step: string | null;
}

/** Split a token-ish name into (stem, step), pulling a trailing run of scale segments off the end. */
const splitScale = (raw: string): Scaled => {
  const segs = raw
    .toLowerCase()
    .split(/[/\-_.\s]+/)
    .filter(Boolean);
  let cut = segs.length;
  while (cut > 0 && isScaleStep(segs[cut - 1] as string)) cut -= 1;
  const stepSegs = segs.slice(cut);
  return {
    stem: segs.slice(0, cut).join(''),
    step: stepSegs.length > 0 ? stepSegs.join('').replace(/[^a-z0-9]/g, '') : null,
  };
};

/** Dice on stems, but only when the scale steps agree (or both sides have none); else no match. */
const stepGatedScore = (figma: Scaled, candidate: Scaled): number => {
  if (figma.step !== null || candidate.step !== null) {
    if (figma.step !== candidate.step) return 0;
  }
  return diceSimilarity(figma.stem, candidate.stem);
};

interface NameMatch {
  token: ProjectToken;
  score: number;
}

const bestNameMatch = (
  figmaName: string,
  projectTokens: readonly ProjectToken[],
): NameMatch | null => {
  const target = splitScale(figmaName);
  let best: NameMatch | null = null;
  for (const token of projectTokens) {
    let score = 0;
    for (const name of matchNames(token))
      score = Math.max(score, stepGatedScore(target, splitScale(name)));
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
    // B1: the name agrees but, for a color whose hex is known on both sides, the value disagrees —
    // the token's color drifted from Figma. Keep the (correct) token, but don't claim "high": cap
    // below the high bar so it reads as "name match, verify the value" rather than a confirmed reuse.
    const candHex = normHex(nameMatch.token.value);
    const valueDisagrees = figmaHex !== null && candHex !== null && candHex !== figmaHex;
    const confidence = valueDisagrees ? Math.min(nameMatch.score, 0.84) : nameMatch.score;
    return {
      ...base,
      candidate: candidateFrom(nameMatch.token, confidence, ['name']),
      status: statusFor(confidence, opts.threshold),
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
