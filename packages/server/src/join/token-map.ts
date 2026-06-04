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
  /**
   * Set only when status is 'framework-builtin': the Tailwind built-in scale this variable belongs
   * to. There is no project token to reuse — for scale "spacing", compose the step with the bound
   * property (p-4 / gap-4 / m-4); for "line-height", use leading-{step} (leading-7); for
   * "font-weight", use font-{step} (font-bold).
   */
  builtin?: { scale: string; step: string };
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

// B3: Tailwind v4 renames several scales that Figma still labels by their CSS/semantic name. The stems
// then differ purely by convention (Figma "rounded/lg" vs Tailwind "--radius-lg") and Dice scores them
// apart, so the right token reads as a gap. A synonym table treats these stems as equivalent. Stems are
// compared in splitScale's normalized form (lowercased, separators stripped), so entries carry no hyphens.
//
// Only *unambiguous* synonyms belong here. Notably NOT size↔text: Figma "size/*" is overloaded — it's
// font sizes in a typography collection (Design A) but dimensions (width/height) elsewhere, so aliasing it
// to Tailwind's --text-* (always font-size) would mis-map dimensional tokens. Disambiguating that needs
// the Figma variable's collection/category, which the join doesn't carry yet — left as a future step.
const STEM_SYNONYMS: readonly ReadonlySet<string>[] = [
  new Set(['radius', 'rounded']), // --radius-*      ↔ rounded/*
  new Set(['leading', 'lineheight']), // --leading-*     ↔ line-height/*
  new Set(['fontweight', 'weight']), // --font-weight-* ↔ weight/*
];

// size↔text is the one synonym that's only safe *in context*. Figma "size/*" is a font size when it
// lives in a typography collection (Design A groups them under "font") but a width/height dimension
// elsewhere — so aliasing it to Tailwind's --text-* (always font-size) is gated on the variable's
// collection rather than enabled globally. Carrying the collection through the join is exactly what
// makes this safe to open without mis-mapping dimensional tokens.
const TYPO_STEM_SYNONYM: ReadonlySet<string> = new Set(['size', 'text']);
const TYPO_COLLECTION_WORDS = new Set([
  'font',
  'fonts',
  'typography',
  'type',
  'text',
  'typeface',
  'typo',
]);

/** Whether a variable's collection name signals typography (word-level match, so "context" ≠ text). */
const isTypographyCollection = (collection: string | undefined): boolean =>
  collection !== undefined &&
  collection
    .toLowerCase()
    .split(/[^a-z]+/)
    .some(word => TYPO_COLLECTION_WORDS.has(word));

/**
 * True when two stems are the same scale by an exact match, a Tailwind/Figma naming synonym, or —
 * only when the Figma side is a typography variable — the context-gated size↔text synonym.
 */
const stemsAlias = (a: string, b: string, typography: boolean): boolean =>
  a === b ||
  STEM_SYNONYMS.some(group => group.has(a) && group.has(b)) ||
  (typography && TYPO_STEM_SYNONYM.has(a) && TYPO_STEM_SYNONYM.has(b));

/**
 * Stem similarity, gated on the scale step agreeing (or both sides having none). A synonym match
 * counts as exact (1) so a renamed-by-convention scale isn't lost to Dice; otherwise fall back to
 * Dice. `typography` opens the context-gated size↔text synonym for the current Figma token.
 */
const stepGatedScore = (figma: Scaled, candidate: Scaled, typography: boolean): number => {
  if (figma.step !== null || candidate.step !== null) {
    if (figma.step !== candidate.step) return 0;
  }
  if (stemsAlias(figma.stem, candidate.stem, typography)) return 1;
  return diceSimilarity(figma.stem, candidate.stem);
};

interface NameMatch {
  token: ProjectToken;
  score: number;
}

const bestNameMatch = (
  figmaName: string,
  projectTokens: readonly ProjectToken[],
  typography: boolean,
): NameMatch | null => {
  const target = splitScale(figmaName);
  let best: NameMatch | null = null;
  for (const token of projectTokens) {
    let score = 0;
    for (const name of matchNames(token))
      score = Math.max(score, stepGatedScore(target, splitScale(name), typography));
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
  /** The project is a Tailwind project — enables the framework built-in scale fallback below. */
  tailwind?: boolean;
}

// Tailwind ships open-ended numeric built-in scales that real projects don't redeclare in @theme — so
// the project CSS has no token to join against and a perfectly usable variable reads as a false gap.
// Both spacing and line-height are `calc(var(--spacing) * N)` in v4, so any step N is a valid utility
// (spacing → composed with the bound property p-/gap-/m-; line-height → leading-N). Keyed by the Figma
// stem normalized like splitScale (lowercased, separators stripped, so "line-height" → "lineheight").
const BUILTIN_NUMERIC_STEMS: ReadonlyMap<string, string> = new Map([
  ['spacing', 'spacing'],
  ['lineheight', 'line-height'],
]);

// Named built-in scale: font-weight. Projects almost never declare it in @theme (you just write
// font-bold), yet designs routinely tokenize it — so weight/* otherwise reads as a false gap. The step
// is a font-style name; map it to Tailwind's font-weight utility name (the one rename is Regular →
// normal). Keys are normalized (lowercased, separators stripped) to absorb "Semi Bold" / "ExtraLight".
const FONT_WEIGHT_STEPS: ReadonlyMap<string, string> = new Map([
  ['thin', 'thin'],
  ['hairline', 'thin'],
  ['extralight', 'extralight'],
  ['ultralight', 'extralight'],
  ['light', 'light'],
  ['regular', 'normal'],
  ['normal', 'normal'],
  ['book', 'normal'],
  ['medium', 'medium'],
  ['semibold', 'semibold'],
  ['demibold', 'semibold'],
  ['bold', 'bold'],
  ['extrabold', 'extrabold'],
  ['ultrabold', 'extrabold'],
  ['black', 'black'],
  ['heavy', 'black'],
]);

const normSeg = (raw: string): string => raw.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Parse a numeric Tailwind step: an integer, a Figma dash-written half-step (1-5 → 1.5), or px. */
const parseNumericStep = (raw: string): string | null => {
  const r = raw.trim().toLowerCase();
  if (r === 'px') return 'px';
  // Figma can't put a dot in a name segment, so 1.5 is authored as "1-5" (value confirms: spacing/1-5
  // = 6px = 1.5 × 4). Normalize that dash to a decimal; reject anything non-numeric (spacing/banner).
  const step = r.replace(/^(\d+)-(\d+)$/, '$1.$2');
  return /^\d+(?:\.\d+)?$/.test(step) ? step : null;
};

/**
 * Recognize a Figma variable as a Tailwind built-in scale step, by name only. Deliberately
 * conservative — it fires only for the stems below (notably NOT size/*, a dimension or a font size
 * depending on collection), and only as a fallback after the project-token join declined, so it can
 * never override a real reuse. The Figma group separator is "/", so split on it: the last segment
 * is the step, the earlier segments are the stem (whose own dashes, e.g. line-height, are part of
 * the name). Numeric scales (spacing, line-height) are open-ended; font-weight is a fixed name map.
 * Returns the scale + step to compose into a utility (p-4 / leading-7 / font-bold), or null.
 */
const tailwindBuiltinScale = (figmaName: string): { scale: string; step: string } | null => {
  const segs = figmaName.trim().split('/');
  if (segs.length < 2) return null;
  const stem = normSeg(segs.slice(0, -1).join(''));
  const stepRaw = segs[segs.length - 1] as string;

  const numericScale = BUILTIN_NUMERIC_STEMS.get(stem);
  if (numericScale !== undefined) {
    const step = parseNumericStep(stepRaw);
    return step === null ? null : { scale: numericScale, step };
  }
  if (stem === 'weight' || stem === 'fontweight') {
    const step = FONT_WEIGHT_STEPS.get(normSeg(stepRaw));
    return step === undefined ? null : { scale: 'font-weight', step };
  }
  return null;
};

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

  const nameMatch = bestNameMatch(
    figma.name,
    projectTokens,
    isTypographyCollection(figma.collection),
  );

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

  // Fallback (B1): nothing in the project matched, but on a Tailwind project a built-in scale step
  // (spacing/N) is still a usable utility — flag it framework-builtin instead of a false gap. This is
  // reached only here, after every project-token path declined, so it can never shadow a real reuse.
  if (opts.tailwind === true) {
    const builtin = tailwindBuiltinScale(figma.name);
    if (builtin !== null) return { ...base, builtin, status: 'framework-builtin' };
  }

  return base;
};

/** Join every Figma token against the project's tokens; pure over its inputs. */
export const joinTokens = (
  figmaTokens: readonly FigmaToken[],
  projectTokens: readonly ProjectToken[],
  opts: TokenJoinOptions,
): TokenMapping[] => figmaTokens.map(t => joinOne(t, projectTokens, opts));
