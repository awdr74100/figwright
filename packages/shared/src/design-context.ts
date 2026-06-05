import { z } from 'zod';

import {
  MIXED,
  SerializedComponentPropertySchema,
  SerializedEffectSchema,
  SerializedFontNameSchema,
  SerializedMainComponentSchema,
  SerializedPaintSchema,
  SerializedStyleIdsSchema,
} from './serialized-node.js';
import type {
  SerializedComponentProperty,
  SerializedEffect,
  SerializedMainComponent,
  SerializedPaint,
  SerializedStyleIds,
} from './serialized-node.js';

export const DETAIL_LEVELS = ['minimal', 'compact', 'full'] as const;
export type DetailLevel = (typeof DETAIL_LEVELS)[number];

/**
 * Token-efficient, depth-limited tree node for LLM exploration. Fields populate by detail level:
 *
 * - Minimal: id / name / type
 * - Compact: + visible / x / y / width / height
 * - Full: + rotation / opacity / cornerRadius / fills / text mixin `truncated` marks children dropped
 *   at the depth limit; `deduped` marks an instance whose main component was already expanded (its
 *   children are omitted), with `mainComponentId` for cross-ref. A deduped instance keeps its own
 *   `textOverrides` — the visible text it actually renders — so codegen gets per-instance content
 *   without re-expanding the collapsed subtree (every card title / list item / form label
 *   differs).
 *
 * Grounding fields (M3): `styleIds` / `boundVariables` link a node to design-system styles and
 * variables (id → token name, resolved downstream); `componentProperties` carries an INSTANCE's
 * resolved variant/boolean/text/swap values (component_map's variant/size source); `mainComponent`
 * names the library component an INSTANCE points to. These survive dedup on the instance itself —
 * only the expanded child subtree is collapsed.
 */
export interface DesignContextNode {
  id: string;
  name: string;
  type: string;
  visible?: boolean;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  opacity?: number;
  cornerRadius?: number | typeof MIXED;
  fills?: readonly z.infer<typeof SerializedPaintSchema>[] | typeof MIXED;
  strokes?: readonly SerializedPaint[];
  strokeWeight?: number | typeof MIXED;
  /**
   * Per-side stroke weights when strokeWeight is `mixed`; 0 = no border on that side, non-zero →
   * border-t / border-r / border-b / border-l.
   */
  strokeWeights?: { top: number; right: number; bottom: number; left: number };
  strokeAlign?: string;
  effects?: readonly SerializedEffect[];
  characters?: string;
  fontSize?: number | typeof MIXED;
  fontName?: z.infer<typeof SerializedFontNameSchema> | typeof MIXED;
  styleIds?: SerializedStyleIds;
  boundVariables?: Readonly<Record<string, readonly string[]>>;
  componentProperties?: Readonly<Record<string, SerializedComponentProperty>>;
  mainComponent?: SerializedMainComponent;
  mainComponentId?: string;
  /**
   * GlobalVars refs (P3): when style dedup runs (full detail), inline `fills` / `strokes` /
   * `effects` / (`fontSize` + `fontName`) are replaced by these refs into `globalVars.styles` — a
   * style shared by N nodes costs one entry + N refs. `fill` / `stroke` point at paint arrays,
   * `effect` at a shadow/blur array, `textStyle` at a typography bundle.
   */
  fill?: string;
  stroke?: string;
  effect?: string;
  textStyle?: string;
  deduped?: boolean;
  /**
   * Per-instance text content of a deduped instance: every visible TEXT descendant's actual
   * `characters` ({ name, characters }, DFS order). Only emitted on deduped instances (the
   * non-deduped first instance still carries its text inline in the expanded subtree). Text-only by
   * design — structure/style stay collapsed, so the codegen "un-deduped vs N-drill" tradeoff goes
   * away while the output stays small.
   */
  textOverrides?: readonly { name: string; characters: string }[];
  truncated?: boolean;
  children?: readonly DesignContextNode[];
}

// Cast through unknown: zod's .optional() outputs `T | undefined`, while DesignContextNode uses
// bare optionals under exactOptionalPropertyTypes. Functionally identical at runtime.
export const DesignContextNodeSchema = z.lazy(() =>
  z.object({
    id: z.string(),
    name: z.string(),
    type: z.string(),
    visible: z.boolean().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    rotation: z.number().optional(),
    opacity: z.number().optional(),
    cornerRadius: z.union([z.number(), z.literal(MIXED)]).optional(),
    fills: z.union([z.array(SerializedPaintSchema), z.literal(MIXED)]).optional(),
    strokes: z.array(SerializedPaintSchema).optional(),
    strokeWeight: z.union([z.number(), z.literal(MIXED)]).optional(),
    strokeWeights: z
      .object({ top: z.number(), right: z.number(), bottom: z.number(), left: z.number() })
      .optional(),
    strokeAlign: z.string().optional(),
    effects: z.array(SerializedEffectSchema).optional(),
    characters: z.string().optional(),
    fontSize: z.union([z.number(), z.literal(MIXED)]).optional(),
    fontName: z.union([SerializedFontNameSchema, z.literal(MIXED)]).optional(),
    styleIds: SerializedStyleIdsSchema.optional(),
    boundVariables: z.record(z.string(), z.array(z.string())).optional(),
    componentProperties: z.record(z.string(), SerializedComponentPropertySchema).optional(),
    mainComponent: SerializedMainComponentSchema.optional(),
    mainComponentId: z.string().optional(),
    fill: z.string().optional(),
    stroke: z.string().optional(),
    effect: z.string().optional(),
    textStyle: z.string().optional(),
    deduped: z.boolean().optional(),
    textOverrides: z.array(z.object({ name: z.string(), characters: z.string() })).optional(),
    truncated: z.boolean().optional(),
    children: z.array(DesignContextNodeSchema).optional(),
  }),
) as unknown as z.ZodType<DesignContextNode>;

/**
 * A resolved design-system token: the human name a node's `styleIds` / `boundVariables` id points
 * to (e.g. `Primary/500`, `size/sm`, `Body/Bold`) plus its kind. Resolution is deduped into the
 * top-level `variables` / `styles` maps so a token referenced by 100 nodes costs one entry — nodes
 * keep the id, the consumer joins id → name. The node's own inline value (fill color, fontSize, …)
 * remains the fallback when a ref is unresolved (e.g. a library var not subscribed).
 */
export const ResolvedTokenSchema = z.object({
  name: z.string(),
  type: z.string(),
});
export type ResolvedToken = z.infer<typeof ResolvedTokenSchema>;

/**
 * Deduplicated style table (P3). Keys are content-hash ids (`fill_AB12CD`, `text_9F3K2L`) so the
 * same style always maps to the same id — output is stable across runs and diffable (unlike
 * Framelink's random ids). Values are opaque style bundles (paint arrays / typography); the
 * consumer renders them per profile (Tailwind class / CSS var / …) via an adapter.
 */
export const GlobalVarsSchema = z.object({
  styles: z.record(z.string(), z.unknown()),
});
export type GlobalVars = z.infer<typeof GlobalVarsSchema>;

/** Quantifies the simplification — chiefly the dedup win (inline vs deduped byte size). */
export const DesignContextMetricsSchema = z.object({
  nodeCount: z.number(),
  maxDepth: z.number(),
  styleCount: z.number(),
  tokenCount: z.number(),
  inlineSizeKb: z.number(),
  dedupedSizeKb: z.number(),
});
export type DesignContextMetrics = z.infer<typeof DesignContextMetricsSchema>;

export const GetDesignContextResultSchema = z.object({
  nodes: z.array(DesignContextNodeSchema),
  /** Deduplicated style table; nodes carry `fill` / `textStyle` refs into it. Full detail only. */
  globalVars: GlobalVarsSchema.optional(),
  /** Id → token, for variable ids referenced by any node's `boundVariables`. Omitted when empty. */
  variables: z.record(z.string(), ResolvedTokenSchema).optional(),
  /** Id → token, for shared-style ids referenced by any node's `styleIds`. Omitted when empty. */
  styles: z.record(z.string(), ResolvedTokenSchema).optional(),
  /** Simplification metrics; full detail only. */
  metrics: DesignContextMetricsSchema.optional(),
});
export type GetDesignContextResult = z.infer<typeof GetDesignContextResultSchema>;
