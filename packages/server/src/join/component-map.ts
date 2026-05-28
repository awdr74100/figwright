import type { DesignContextNode } from '@figma-mcp-relay/shared';

import type { ScannedComponent } from '../scan/scan.js';

// The component join: Figma component name → existing code component. Unlike the token half (CSS
// custom properties are mechanically derivable from the variable name), there is no shortcut here —
// the Figma name has to be matched against what was actually scanned off disk. Matching is name-based
// (fuzzy, framework-agnostic) with a small bonus when the instance's variant axes line up with the
// code component's props. An explicit docs/figma-component-map.md row, when present, overrides the
// fuzzy guess. All scoring lives in pure functions so the join is unit-testable without Figma or fs.

export type MappingStatus = 'high' | 'medium' | 'low' | 'unmapped';

/**
 * One instance of a component, with its resolved component-property values (variant / boolean /
 * text).
 */
export interface FigmaInstance {
  nodeId: string;
  /**
   * Property axis → value for this instance, e.g. { Size: "Medium", "show 必填": true }. Codegen
   * wires these onto the reused component's props. Absent when the instance has no component
   * properties.
   */
  props?: Record<string, string | boolean>;
}

/** A distinct Figma component as used in the design, with its instances grouped. */
export interface FigmaComponentUsage {
  /** Logical name used for the join (the instance/main-component display name). */
  name: string;
  mainComponentId?: string;
  /** Union of variant/boolean/text/swap axes seen across instances (component_map's variant source). */
  variantAxes: string[];
  /** Every instance of this component (so it's mapped once, not per-instance), each with its props. */
  instances: FigmaInstance[];
  instanceCount: number;
}

export interface ComponentMapping {
  figmaComponentName: string;
  mainComponentId?: string;
  variantAxes: string[];
  instances: FigmaInstance[];
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
    instances: usage.instances,
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
 * ComponentId → its containing component set, built from get_local_components (see
 * handleComponentMap).
 */
export type ComponentSetIndex = ReadonlyMap<string, { id: string; name: string }>;

/**
 * Walk a design-context tree and group INSTANCE nodes by their main component, so a component used
 * N times yields one usage with N instance ids (not N rows). Collapsed (deduped) subtrees still
 * carry the instance's own name / mainComponentId, so deduped instances are counted too.
 *
 * Figma resolves a variant instance's `mainComponent` to the _variant_ ("Size=Large, State=Hover"),
 * not the _set_ ("Button") — so without help every variant fragments into its own row and matches
 * "Size"/"State" garbage. setIndex (componentId → set) lets us group by the set and name the usage
 * after it, which is what the fuzzy match and the docs/figma-component-map.md override key on.
 * Falls back to the variant/main name, then the node name, for components that aren't part of a
 * set.
 */
export const collectFigmaComponents = (
  root: DesignContextNode,
  setIndex: ComponentSetIndex = new Map(),
): FigmaComponentUsage[] => {
  const byKey = new Map<string, FigmaComponentUsage>();

  const visit = (node: DesignContextNode): void => {
    if (node.type === 'INSTANCE') {
      const variantId = node.mainComponentId ?? node.mainComponent?.id;
      const set = variantId === undefined ? undefined : setIndex.get(variantId);
      const name = set?.name ?? node.mainComponent?.name ?? node.name;
      const groupId = set?.id ?? variantId;
      const key = groupId ?? name;
      const usage: FigmaComponentUsage = byKey.get(key) ?? {
        name,
        ...(groupId === undefined ? {} : { mainComponentId: groupId }),
        variantAxes: [],
        instances: [],
        instanceCount: 0,
      };
      byKey.set(key, usage);
      usage.instanceCount += 1;

      // Resolve this instance's component-property values into { axis: value }, recording each axis on
      // the union variantAxes. Figma axis names can carry a disambiguation suffix ("Size#12:0") — keep
      // the label only. Codegen reads props to wire the reused component (size/state, required, …).
      const props: Record<string, string | boolean> = {};
      for (const [axis, prop] of Object.entries(node.componentProperties ?? {})) {
        const label = axis.split('#')[0] ?? axis;
        props[label] = prop.value;
        if (!usage.variantAxes.includes(label)) usage.variantAxes.push(label);
      }
      usage.instances.push({
        nodeId: node.id,
        ...(Object.keys(props).length > 0 ? { props } : {}),
      });
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
