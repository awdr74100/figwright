import type { DesignContextNode, SerializedPaint } from '@figma-mcp-relay/shared';

import type { RepoSvg, SvgColorContract } from '../icons/repo-icons.js';
import type { ProjectProfile } from '../profile/profile.js';
import { diceSimilarity, type MappingStatus } from './component-map.js';

// The icon join: a Figma icon node → an existing project `.svg` file, so codegen reuses the designer's
// curated asset instead of re-exporting a duplicate. Like the component/token joins it's name-based and
// pure (no Figma, no fs). It carries two extra dimensions the other joins don't need:
//   - a *color contract* (read from the matched file) deciding whether/how the icon may be recolored, and
//   - whether recoloring is even possible given how the project imports svg (currentColor dies through
//     an <img> in url mode), so a wrong recolor instruction is caught at grounding time.
// Per-icon it only ever claims a *verified* file match; the library route (lucide / iconify) is surfaced
// at the result level by the tool, not fabricated here.

const ICON_MARKER = /(^|[\s/_-])ic(on)?s?([\s/_-]|$)/i;
// Figma's default names for vector art that isn't a named, reusable icon — excluded so a decorative
// stroke ("Vector 3") doesn't read as a missing icon. A real icon is named (search, arrow-right).
const DEFAULT_VECTOR_NAME =
  /^(vector|union|subtract|intersect|exclude|rectangle|ellipse|line|polygon|star|group|frame|shape|path|oval|boolean)\s*\d*$/i;
const VECTOR_TYPES = new Set(['VECTOR', 'BOOLEAN_OPERATION']);

const carriesMarker = (node: DesignContextNode): boolean =>
  ICON_MARKER.test(node.name) ||
  (node.mainComponent !== undefined &&
    (ICON_MARKER.test(node.mainComponent.name) ||
      (node.mainComponent.componentSetName !== undefined &&
        ICON_MARKER.test(node.mainComponent.componentSetName))));

/** The label to match on: the set/main name for an instance, else the node name. */
const sourceName = (node: DesignContextNode): string =>
  node.mainComponent?.componentSetName ?? node.mainComponent?.name ?? node.name;

/**
 * Strip the icon decoration off a name → the bare icon label ("Icons/ic_arrow-right" →
 * "arrow-right").
 */
export const iconLabel = (raw: string): string => {
  const segs = raw
    .split('/')
    .map(s => s.trim())
    .filter(Boolean);
  while (segs.length > 1 && /^ic(on)?s?$/i.test(segs[0] as string)) segs.shift();
  const last = segs[segs.length - 1] ?? raw;
  return last.replace(/^ic(on)?s?[-_]/i, '').trim();
};

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

const hex2 = (n: number): string =>
  Math.round(Math.max(0, Math.min(1, n)) * 255)
    .toString(16)
    .padStart(2, '0');

const toHex = (c: { r: number; g: number; b: number }): string =>
  `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`.toUpperCase();

/** The icon's intended color at the usage site: a solid fill hex and/or a bound variable. */
const fillOf = (node: DesignContextNode): IconMapping['fill'] => {
  const out: { hex?: string; variable?: boolean } = {};
  const fills = node.fills;
  if (Array.isArray(fills)) {
    const solid = (fills as SerializedPaint[]).find(p => p.type === 'SOLID' && p.visible !== false);
    if (solid?.type === 'SOLID') out.hex = toHex(solid.color);
  }
  if (node.boundVariables?.fills !== undefined && node.boundVariables.fills.length > 0)
    out.variable = true;
  return out.hex === undefined && out.variable === undefined ? undefined : out;
};

export interface FigmaIconUsage {
  /** Bare icon label used for the join + display (decoration stripped). */
  name: string;
  /** The original Figma node name, kept for the report. */
  figmaName: string;
  nodeIds: string[];
  fill?: { hex?: string; variable?: boolean };
}

/**
 * Walk the grounded trees and collect icon usages, grouped by label so an icon used N times is one
 * row with N node ids. An icon "root" is recorded without recursing into it, so the vectors inside
 * a named icon aren't double-counted. Detection (name-marker / vector-leaf with a meaningful name)
 * is deliberately a best guess — a false positive just yields an `unmapped` row the agent can
 * ignore, while the alternative (missing reuse) is the costlier error.
 */
export const collectFigmaIcons = (roots: readonly DesignContextNode[]): FigmaIconUsage[] => {
  const byKey = new Map<string, FigmaIconUsage>();

  const record = (node: DesignContextNode): void => {
    const figmaName = sourceName(node);
    const label = iconLabel(figmaName);
    if (label === '') return;
    const key = norm(label);
    const usage: FigmaIconUsage = byKey.get(key) ?? { name: label, figmaName, nodeIds: [] };
    usage.nodeIds.push(node.id);
    const fill = fillOf(node);
    if (usage.fill === undefined && fill !== undefined) usage.fill = fill;
    byKey.set(key, usage);
  };

  const visit = (node: DesignContextNode): void => {
    const marker = carriesMarker(node);
    const isVectorLeaf = VECTOR_TYPES.has(node.type);
    const isInstanceLike = node.type === 'INSTANCE' || node.type === 'COMPONENT';

    // An icon root we record and stop descending into.
    if (
      (isInstanceLike && marker) ||
      marker ||
      (isVectorLeaf && !DEFAULT_VECTOR_NAME.test(node.name.trim()))
    ) {
      record(node);
      return;
    }
    for (const child of node.children ?? []) visit(child);
  };

  for (const root of roots) visit(root);
  return [...byKey.values()];
};

export interface IconMapping {
  figmaName: string;
  name: string;
  nodeIds: string[];
  fill?: { hex?: string; variable?: boolean };
  candidate?: {
    /** Repo-relative path of the matched `.svg`. */
    filePath: string;
    colorContract: SvgColorContract;
    /** How to color it in this project, grounded off the contract + svg mode + styling system. */
    recolor: string;
    confidence: number;
  };
  status: MappingStatus;
}

// Deliberately no fabricated `import` string. The loader form (?react / ?component / { ReactComponent }
// / url) is already returned at the result level on profile.svg.importHint, and the actual specifier —
// an alias like @/assets/… or a path relative to the *consuming* file — depends on the project's alias
// config (tsconfig paths / vite resolve.alias, a long tail) and the not-yet-written caller's location,
// which the join can't know. Precomputing it would mean guessing, and a confidently-wrong import is
// worse than none. So, like component_map (which only returns filePath), we ground the file + loader
// form + color contract and let codegen compose the import, mirroring the project's existing imports.

/** How to recolor, grounded off the file's contract and whether this project's svg mode allows it. */
const recolorGuidance = (
  contract: SvgColorContract,
  svg: ProjectProfile['svg'],
  tailwind: boolean,
): string => {
  const colorClass = tailwind ? 'text-{token}' : 'the CSS `color` property (or var(--token))';
  switch (contract) {
    case 'currentColor':
      return svg.mode === 'component'
        ? `recolorable — set ${colorClass} at the usage site (fill is currentColor); it also inherits the parent's text color`
        : `currentColor can't apply through an <img> (url mode) — inline the svg or add an svg loader to recolor, else it renders with no color`;
    case 'fixed':
      return 'single fixed color baked into the file — not recolorable via CSS; if the Figma fill differs, convert its fills to currentColor or re-export';
    case 'multi-color':
      return 'multi-color asset — render as-is, do not recolor';
    case 'unknown':
      return 'color contract unclear (no explicit fill or currentColor found) — inspect the svg before relying on recolor';
  }
};

const statusFor = (confidence: number, threshold: number): MappingStatus => {
  if (confidence >= 0.85) return 'high';
  if (confidence >= threshold) return 'medium';
  if (confidence >= 0.5) return 'low';
  return 'unmapped';
};

export interface IconJoinOptions {
  threshold: number;
  svg: ProjectProfile['svg'];
  tailwind: boolean;
}

// Icons demand near-exact matching, unlike the component join. The asymmetry is the reason: a wrong
// icon file is a *silent visual bug* (an up-arrow rendered as the matched down-arrow), while a missed
// match just re-exports the correct icon fresh — so precision beats recall. Raw Dice can't separate a
// real typo ("inifinte"→infinite, 0.71) from a wrong neighbor ("checkbox"→check 0.73, "arr-u"→arr-d
// 0.67, "cash"→trash 0.57) — they overlap — and the wrong ones are the costlier error, so the floor
// is set at the high bar: only an exact (after separator/space normalization) or long-name one-char
// match reuses a file; everything else falls through to a fresh export. (Real synonyms like
// trash↔delete need a synonym table, not fuzz — a future step, same as the token join's.)
const ICON_MATCH_FLOOR = 0.85;

const bestSvgMatch = (
  label: string,
  svgs: readonly RepoSvg[],
): { svg: RepoSvg; score: number } | null => {
  const target = norm(label);
  let best: { svg: RepoSvg; score: number } | null = null;
  for (const svg of svgs) {
    const score = Math.max(
      diceSimilarity(target, norm(svg.fileName)),
      diceSimilarity(target, norm(iconLabel(svg.fileName))),
    );
    if (best === null || score > best.score) best = { svg, score };
  }
  return best;
};

const joinOne = (
  icon: FigmaIconUsage,
  svgs: readonly RepoSvg[],
  opts: IconJoinOptions,
): IconMapping => {
  const base: IconMapping = {
    figmaName: icon.figmaName,
    name: icon.name,
    nodeIds: icon.nodeIds,
    ...(icon.fill === undefined ? {} : { fill: icon.fill }),
    status: 'unmapped',
  };

  const match = bestSvgMatch(icon.name, svgs);
  if (match === null || match.score < ICON_MATCH_FLOOR) return base;

  const confidence = Number(match.score.toFixed(3));
  return {
    ...base,
    candidate: {
      filePath: match.svg.path,
      colorContract: match.svg.colorContract,
      recolor: recolorGuidance(match.svg.colorContract, opts.svg, opts.tailwind),
      confidence,
    },
    status: statusFor(confidence, opts.threshold),
  };
};

/** Join every Figma icon usage against the project's `.svg` files; pure over its inputs. */
export const joinIcons = (
  icons: readonly FigmaIconUsage[],
  svgs: readonly RepoSvg[],
  opts: IconJoinOptions,
): IconMapping[] => icons.map(i => joinOne(i, svgs, opts));
