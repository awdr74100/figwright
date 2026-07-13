import type { DesignContextNode } from '@figwright/shared';

import type { ScannedComponent } from '../scan/scan.js';

// The component join: Figma component name → existing code component. Unlike the token half (CSS
// custom properties are mechanically derivable from the variable name), there is no shortcut here —
// the Figma name has to be matched against what was actually scanned off disk. Matching is name-based
// (fuzzy, framework-agnostic) with a small bonus when the instance's variant axes line up with the
// code component's props. An explicit docs/figma-component-map.md row, when present, overrides the
// fuzzy guess. All scoring lives in pure functions so the join is unit-testable without Figma or fs.

// 'framework-builtin' is token-map only: a Figma variable that maps to a Tailwind built-in scale step
// (e.g. spacing/4 → the `-4` step) which real projects never redeclare in @theme, so it has no project
// token to join against yet is not a real gap. The component join never produces it.
export type MappingStatus = 'high' | 'medium' | 'low' | 'unmapped' | 'framework-builtin';

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
    /**
     * Figma component-property axes (variant / boolean / text) with no matching prop on the
     * candidate — the actionable inverse of matchedProps. The component must be extended to carry
     * them (e.g. a leading-icon toggle, a `required` flag, an active/selected state). Codegen
     * surfaces these as component-extension TODOs instead of silently dropping the design intent.
     */
    unmatchedProps: string[];
  };
  status: MappingStatus;
  /** Which path produced the mapping. */
  source: 'map-file' | 'scan';
  /**
   * Set when the map file had a row for this component but its target neither parsed in the scan
   * nor exists on disk — a stale recorded mapping (the file was deleted/renamed after it was
   * recorded). The mapping degrades to the fuzzy/unmapped result rather than asserting a phantom
   * import; this carries the dead row so the caller can re-record or remove it. Absent on a healthy
   * override.
   */
  staleOverride?: { name: string; filePath: string };
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

/**
 * Split a usage's Figma axes into those the candidate already has as props (matchedProps) and those
 * it lacks (unmatchedProps — the component-extension TODOs). Same casefold predicate for both, so
 * matched ∪ unmatched == variantAxes.
 *
 * When the component's props couldn't be parsed (propsExtracted === false — a baseline scan that
 * didn't read props), we can't tell matched from unmatched: return both empty rather than dumping
 * every axis into unmatchedProps, which would otherwise report a true "extend this component" TODO
 * for props that very likely already exist (the case for an unparsed Vue/Svelte SFC).
 */
const partitionAxes = (
  variantAxes: readonly string[],
  component: ScannedComponent,
): { matchedProps: string[]; unmatchedProps: string[] } => {
  if (!component.propsExtracted) return { matchedProps: [], unmatchedProps: [] };
  const codeProps = new Set(component.propNames.map(p => p.toLowerCase()));
  const matchedProps: string[] = [];
  const unmatchedProps: string[] = [];
  for (const axis of variantAxes) {
    (codeProps.has(axis.toLowerCase()) ? matchedProps : unmatchedProps).push(axis);
  }
  return { matchedProps, unmatchedProps };
};

/**
 * The scanned component an override points to, so its props can be diffed against the Figma axes
 * even on the map-file path. Match by repo-relative path first, then by component name.
 */
const resolveOverrideComponent = (
  override: { name: string; filePath: string },
  scanned: readonly ScannedComponent[],
): ScannedComponent | undefined =>
  scanned.find(c => c.filePath === override.filePath) ??
  scanned.find(c => norm(c.name) === norm(override.name));

export interface JoinOptions {
  threshold: number;
  /** Explicit figmaName → code target overrides (highest authority). */
  overrides?: ReadonlyMap<string, { name: string; filePath: string }>;
  /**
   * The override keys (raw and normalized, mirroring `overrides`) whose target file exists on disk.
   * The tool computes this (fs lives there, not in this pure join). An override is trusted when the
   * scan resolves it OR its file is on disk; only one that is neither is treated as stale.
   */
  overridesOnDisk?: ReadonlySet<string>;
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
    const component = resolveOverrideComponent(override, scanned);
    // Trust the override when the scan resolved it (a parsed component) OR its file is on disk (the
    // scanner missed a real file — an unusual export the human/LLM knew about). Only an override that
    // is neither is stale: honouring it would ship an import of a deleted/renamed module, strictly
    // worse than falling back to the fuzzy guess. So a stale one falls through, tagged for cleanup.
    const onDisk =
      opts.overridesOnDisk?.has(usage.name) === true ||
      opts.overridesOnDisk?.has(norm(usage.name)) === true;
    if (component !== undefined || onDisk) {
      const { matchedProps, unmatchedProps } = component
        ? partitionAxes(usage.variantAxes, component)
        : { matchedProps: [], unmatchedProps: [] };
      return {
        ...shared,
        candidate: {
          name: override.name,
          filePath: override.filePath,
          confidence: 1,
          matchedProps,
          unmatchedProps,
        },
        status: 'high',
        source: 'map-file',
      };
    }
    // Stale: degrade to the normal join below, but carry the dead row so the caller can fix it.
    return { ...joinScan(usage, scanned, opts, shared), staleOverride: override };
  }

  return joinScan(usage, scanned, opts, shared);
};

/** The fuzzy-scan half of the join (no override) — also the fallback when an override is stale. */
const joinScan = (
  usage: FigmaComponentUsage,
  scanned: readonly ScannedComponent[],
  opts: JoinOptions,
  shared: Omit<ComponentMapping, 'candidate' | 'status' | 'source' | 'staleOverride'>,
): ComponentMapping => {
  const match = bestNameMatch(usage.name, scanned);
  if (match === null || match.score < 0.5) {
    return { ...shared, status: 'unmapped', source: 'scan' };
  }

  // Variant bonus: reward code props that cover the instance's variant axes, but only once the name
  // already plausibly matches, so an unrelated component can't be promoted on prop overlap alone.
  const { matchedProps, unmatchedProps } = partitionAxes(usage.variantAxes, match.component);
  const bonus = Math.min(MAX_VARIANT_BONUS, matchedProps.length * VARIANT_BONUS_PER_PROP);
  const confidence = Math.min(1, Number((match.score + bonus).toFixed(3)));

  return {
    ...shared,
    candidate: {
      name: match.component.name,
      filePath: match.component.filePath,
      confidence,
      matchedProps,
      unmatchedProps,
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
 * Walk the design-context trees and group INSTANCE nodes by their main component, so a component
 * used N times yields one usage with N instance ids (not N rows). Takes ALL top-level roots and
 * shares one group map across them, so a component reused across sibling frames (e.g. scanning a
 * whole page, not a single frame) collapses to one usage instead of one-per-frame. Collapsed
 * (deduped) subtrees still carry the instance's own name / mainComponentId, so deduped instances
 * are counted too.
 *
 * Figma resolves a variant instance's `mainComponent` to the _variant_ ("Size=Large, State=Hover"),
 * not the _set_ ("Button") — so without help every variant fragments into its own row and matches
 * "Size"/"State" garbage. setIndex (componentId → set) lets us group by the set and name the usage
 * after it, which is what the fuzzy match and the docs/figma-component-map.md override key on.
 * Falls back to the variant/main name, then the node name, for components that aren't part of a
 * set.
 */
export const collectFigmaComponents = (
  roots: readonly DesignContextNode[],
  setIndex: ComponentSetIndex = new Map(),
): FigmaComponentUsage[] => {
  const byKey = new Map<string, FigmaComponentUsage>();

  const visit = (node: DesignContextNode): void => {
    if (node.type === 'INSTANCE') {
      const variantId = node.mainComponentId ?? node.mainComponent?.id;
      // Prefer the COMPONENT_SET carried on the grounded mainComponent: get_design_context resolves it
      // for free off the variant's parent, so component_map needs no doc-wide get_local_components
      // scan (which was 68s+ on large files). setIndex (legacy / override-built) is the fallback.
      const carriedSetName = node.mainComponent?.componentSetName;
      const set: { id: string | undefined; name: string } | undefined =
        carriedSetName !== undefined
          ? { id: node.mainComponent?.componentSetId, name: carriedSetName }
          : variantId === undefined
            ? undefined
            : setIndex.get(variantId);
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

  for (const root of roots) visit(root);
  return [...byKey.values()];
};

// The exact column labels a header row uses. Matched whole-cell (not as a substring) so a real data
// row is never mistaken for the header: a figma name that merely contains "figma" or a ref that
// contains "value" (e.g. `| Figma/Logo | brand-value |`) stays a data row. A row is a header only
// when BOTH of its first two cells are pure labels.
const MAP_HEADER_CELLS = new Set([
  'figma',
  'figma name',
  'figmaname',
  'name',
  'code',
  'path',
  'component',
  'token',
  'ref',
  'value',
  'css',
  'var',
  'cssvar',
  'mapping',
]);
/** A markdown alignment/separator cell: dashes with optional leading/trailing colons (`:---:`). */
const isSeparatorCell = (s: string): boolean => /^:?-+:?$/.test(s);

/**
 * Parse one map-file line into [figmaName, target], or null when it carries no mapping (a blank
 * line, a table header, or an alignment separator). Shared by the component and token map parsers
 * so both skip headers/separators identically. Accepts a table row (`| Figma | target |`) or an
 * arrow line (`Figma -> target`).
 */
export const parseMapLine = (line: string): [string, string] | null => {
  let figma: string;
  let target: string;
  const arrow = line.split('->');
  if (arrow.length === 2 && arrow[0] !== undefined && arrow[1] !== undefined) {
    figma = arrow[0].trim();
    target = arrow[1].trim();
  } else if (line.trim().startsWith('|')) {
    const cells = line
      .split('|')
      .map(c => c.trim())
      .filter(Boolean);
    if (cells[0] === undefined || cells[1] === undefined) return null;
    figma = cells[0];
    target = cells[1];
  } else {
    return null;
  }
  if (!figma || !target) return null;
  if (isSeparatorCell(target)) return null; // `| --- | --- |` separator (or a dashes-only target)
  // Header only when BOTH cells are pure labels, so a data row that merely contains a label word
  // (`| Figma/Logo | brand-value |`) is never mistaken for it.
  if (MAP_HEADER_CELLS.has(figma.toLowerCase()) && MAP_HEADER_CELLS.has(target.toLowerCase())) {
    return null;
  }
  return [figma, target];
};

/**
 * Parse docs/figma-component-map.md overrides. Accepts two-column markdown table rows (`| FigmaName
 * | path/or/Name |`) and arrow lines (`FigmaName -> path/or/Name`), skipping the header/separator.
 * The target's basename (sans extension) is the component name; the cell is the path.
 */
export const parseMapFile = (markdown: string): Map<string, { name: string; filePath: string }> => {
  const out = new Map<string, { name: string; filePath: string }>();
  for (const line of markdown.split('\n')) {
    const row = parseMapLine(line);
    if (row === null) continue;
    const [f, t] = row;
    const base = t.split('/').pop() ?? t;
    const name = base.replace(/\.[a-z]+$/i, '');
    out.set(f, { name, filePath: t });
    out.set(norm(f), { name, filePath: t });
  }
  return out;
};
