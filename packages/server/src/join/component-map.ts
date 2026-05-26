import type { DesignContextNode } from '@figma-mcp-relay/shared';

import type { ScannedComponent } from '../scan/scan.js';

// The component join: Figma component name → existing code component. Unlike the token half (CSS
// custom properties are mechanically derivable from the variable name), there is no shortcut here —
// the Figma name has to be matched against what was actually scanned off disk. Matching is name-based
// (fuzzy, framework-agnostic) with a small bonus when the instance's variant axes line up with the
// code component's props. An explicit docs/figma-component-map.md row, when present, overrides the
// fuzzy guess. All scoring lives in pure functions so the join is unit-testable without Figma or fs.

export type MappingStatus = 'high' | 'medium' | 'low' | 'unmapped';

/** A distinct Figma component as used in the design, with its instances grouped. */
export interface FigmaComponentUsage {
  /** Logical name used for the join (the instance/main-component display name). */
  name: string;
  mainComponentId?: string;
  /** Union of variant/boolean/text/swap axes seen across instances (component_map's variant source). */
  variantAxes: string[];
  /** Node ids of every instance of this component — so it's mapped once, not per-instance. */
  instanceNodeIds: string[];
  instanceCount: number;
}

export interface ComponentMapping {
  figmaComponentName: string;
  mainComponentId?: string;
  variantAxes: string[];
  instanceNodeIds: string[];
  instanceCount: number;
  candidate?: {
    name: string;
    filePath: string;
    confidence: number;
    /** Variant axes that also exist as props on the matched component. */
    matchedProps: string[];
  };
  status: MappingStatus;
  /** Which path produced the mapping. */
  source: 'map-file' | 'scan';
}

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

const bigramCounts = (s: string): Map<string, number> => {
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i += 1) {
    const g = s.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
};

/** Character-bigram Dice coefficient — a deterministic, dependency-free fuzzy string similarity. */
export const diceSimilarity = (a: string, b: string): number => {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const ba = bigramCounts(a);
  const bb = bigramCounts(b);
  let overlap = 0;
  for (const [g, count] of ba) overlap += Math.min(count, bb.get(g) ?? 0);
  return (2 * overlap) / (a.length - 1 + (b.length - 1));
};

/**
 * Figma names carry decoration the code side won't ("Button/Primary", "Size=Large, State=Hover").
 * Generate the plausible logical names to try so a slash- or variant-suffixed name still matches
 * the bare code component name.
 */
const nameCandidates = (figmaName: string): string[] => {
  const base = figmaName.split(/[=,]/)[0]?.trim() ?? figmaName;
  const slashParts = figmaName
    .split('/')
    .map(s => s.trim())
    .filter(Boolean);
  return [...new Set([figmaName, base, ...slashParts])];
};

interface NameMatch {
  component: ScannedComponent;
  score: number;
}

/** Best name-only match for a Figma component across the scanned set (max Dice over name variants). */
const bestNameMatch = (
  figmaName: string,
  scanned: readonly ScannedComponent[],
): NameMatch | null => {
  const candidates = nameCandidates(figmaName).map(norm);
  let best: NameMatch | null = null;
  for (const component of scanned) {
    const target = norm(component.name);
    let score = 0;
    for (const candidate of candidates) score = Math.max(score, diceSimilarity(candidate, target));
    if (best === null || score > best.score) best = { component, score };
  }
  return best;
};

const VARIANT_BONUS_PER_PROP = 0.05;
const MAX_VARIANT_BONUS = 0.1;

const statusFor = (confidence: number, threshold: number): MappingStatus => {
  if (confidence >= 0.85) return 'high';
  if (confidence >= threshold) return 'medium';
  if (confidence >= 0.5) return 'low';
  return 'unmapped';
};

export interface JoinOptions {
  threshold: number;
  /** Explicit figmaName → code target overrides (highest authority). */
  overrides?: ReadonlyMap<string, { name: string; filePath: string }>;
}

/** Join one Figma component usage against the scanned components + any explicit override. */
const joinOne = (
  usage: FigmaComponentUsage,
  scanned: readonly ScannedComponent[],
  opts: JoinOptions,
): ComponentMapping => {
  const shared = {
    figmaComponentName: usage.name,
    ...(usage.mainComponentId === undefined ? {} : { mainComponentId: usage.mainComponentId }),
    variantAxes: usage.variantAxes,
    instanceNodeIds: usage.instanceNodeIds,
    instanceCount: usage.instanceCount,
  };

  const override = opts.overrides?.get(usage.name) ?? opts.overrides?.get(norm(usage.name));
  if (override !== undefined) {
    return {
      ...shared,
      candidate: {
        name: override.name,
        filePath: override.filePath,
        confidence: 1,
        matchedProps: [],
      },
      status: 'high',
      source: 'map-file',
    };
  }

  const match = bestNameMatch(usage.name, scanned);
  if (match === null || match.score < 0.5) {
    return { ...shared, status: 'unmapped', source: 'scan' };
  }

  // Variant bonus: reward code props that cover the instance's variant axes, but only once the name
  // already plausibly matches, so an unrelated component can't be promoted on prop overlap alone.
  const codeProps = new Set(match.component.propNames.map(p => p.toLowerCase()));
  const matchedProps = usage.variantAxes.filter(axis => codeProps.has(axis.toLowerCase()));
  const bonus = Math.min(MAX_VARIANT_BONUS, matchedProps.length * VARIANT_BONUS_PER_PROP);
  const confidence = Math.min(1, Number((match.score + bonus).toFixed(3)));

  return {
    ...shared,
    candidate: {
      name: match.component.name,
      filePath: match.component.filePath,
      confidence,
      matchedProps,
    },
    status: statusFor(confidence, opts.threshold),
    source: 'scan',
  };
};

/** Join every Figma component usage; pure over its inputs. */
export const joinComponents = (
  usages: readonly FigmaComponentUsage[],
  scanned: readonly ScannedComponent[],
  opts: JoinOptions,
): ComponentMapping[] => usages.map(u => joinOne(u, scanned, opts));

/**
 * Walk a design-context tree and group INSTANCE nodes by their main component, so a component used
 * N times yields one usage with N instance ids (not N rows). Collapsed (deduped) subtrees still carry
 * the instance's own name / mainComponentId, so deduped instances are counted too.
 */
export const collectFigmaComponents = (root: DesignContextNode): FigmaComponentUsage[] => {
  const byKey = new Map<string, FigmaComponentUsage>();

  const visit = (node: DesignContextNode): void => {
    if (node.type === 'INSTANCE') {
      const name = node.mainComponent?.name ?? node.name;
      const mainComponentId = node.mainComponentId ?? node.mainComponent?.id;
      const key = mainComponentId ?? name;
      const usage: FigmaComponentUsage = byKey.get(key) ?? {
        name,
        ...(mainComponentId === undefined ? {} : { mainComponentId }),
        variantAxes: [],
        instanceNodeIds: [],
        instanceCount: 0,
      };
      byKey.set(key, usage);
      usage.instanceNodeIds.push(node.id);
      usage.instanceCount += 1;
      for (const axis of Object.keys(node.componentProperties ?? {})) {
        // Variant axis names in Figma can carry a disambiguation suffix ("Size#12:0"); keep the label.
        const label = axis.split('#')[0] ?? axis;
        if (!usage.variantAxes.includes(label)) usage.variantAxes.push(label);
      }
    }
    for (const child of node.children ?? []) visit(child);
  };

  visit(root);
  return [...byKey.values()];
};

/**
 * Parse docs/figma-component-map.md overrides. Accepts two-column markdown table rows (`| FigmaName
 * | path/or/Name |`) and arrow lines (`FigmaName -> path/or/Name`), skipping the header/separator.
 * The target's basename (sans extension) is the component name; the cell is the path.
 */
export const parseMapFile = (markdown: string): Map<string, { name: string; filePath: string }> => {
  const out = new Map<string, { name: string; filePath: string }>();
  const add = (figma: string, target: string): void => {
    const f = figma.trim();
    const t = target.trim();
    if (!f || !t || /^-+$/.test(t)) return;
    const base = t.split('/').pop() ?? t;
    const name = base.replace(/\.[a-z]+$/i, '');
    out.set(f, { name, filePath: t });
    out.set(norm(f), { name, filePath: t });
  };

  for (const line of markdown.split('\n')) {
    const arrow = line.split('->');
    if (arrow.length === 2 && arrow[0] !== undefined && arrow[1] !== undefined) {
      add(arrow[0], arrow[1]);
      continue;
    }
    if (line.trim().startsWith('|')) {
      const cells = line
        .split('|')
        .map(c => c.trim())
        .filter(Boolean);
      if (cells.length >= 2 && cells[0] !== undefined && cells[1] !== undefined) {
        if (/figma/i.test(cells[0]) && /code|path|component/i.test(cells[1])) continue; // header
        add(cells[0], cells[1]);
      }
    }
  }
  return out;
};
