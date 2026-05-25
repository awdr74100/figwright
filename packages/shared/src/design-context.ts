import * as v from 'valibot';

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
 * - minimal: id / name / type
 * - compact: + visible / x / y / width / height
 * - full: + rotation / opacity / cornerRadius / fills / text mixin
 * `truncated` marks children dropped at the depth limit; `deduped` marks an instance whose main
 * component was already expanded (its children are omitted), with `mainComponentId` for cross-ref.
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
  fills?: readonly v.InferOutput<typeof SerializedPaintSchema>[] | typeof MIXED;
  strokes?: readonly SerializedPaint[];
  strokeWeight?: number | typeof MIXED;
  strokeAlign?: string;
  effects?: readonly SerializedEffect[];
  characters?: string;
  fontSize?: number | typeof MIXED;
  fontName?: v.InferOutput<typeof SerializedFontNameSchema> | typeof MIXED;
  styleIds?: SerializedStyleIds;
  boundVariables?: Readonly<Record<string, readonly string[]>>;
  componentProperties?: Readonly<Record<string, SerializedComponentProperty>>;
  mainComponent?: SerializedMainComponent;
  mainComponentId?: string;
  /**
   * globalVars refs (P3): when style dedup runs (full detail), inline `fills` / `strokes` /
   * `effects` / (`fontSize` + `fontName`) are replaced by these refs into `globalVars.styles` —
   * a style shared by N nodes costs one entry + N refs. `fill` / `stroke` point at paint arrays,
   * `effect` at a shadow/blur array, `textStyle` at a typography bundle.
   */
  fill?: string;
  stroke?: string;
  effect?: string;
  textStyle?: string;
  deduped?: boolean;
  truncated?: boolean;
  children?: readonly DesignContextNode[];
}

export const DesignContextNodeSchema: v.GenericSchema<DesignContextNode> = v.lazy(() =>
  v.object({
    id: v.string(),
    name: v.string(),
    type: v.string(),
    visible: v.exactOptional(v.boolean()),
    x: v.exactOptional(v.number()),
    y: v.exactOptional(v.number()),
    width: v.exactOptional(v.number()),
    height: v.exactOptional(v.number()),
    rotation: v.exactOptional(v.number()),
    opacity: v.exactOptional(v.number()),
    cornerRadius: v.exactOptional(v.union([v.number(), v.literal(MIXED)])),
    fills: v.exactOptional(v.union([v.array(SerializedPaintSchema), v.literal(MIXED)])),
    strokes: v.exactOptional(v.array(SerializedPaintSchema)),
    strokeWeight: v.exactOptional(v.union([v.number(), v.literal(MIXED)])),
    strokeAlign: v.exactOptional(v.string()),
    effects: v.exactOptional(v.array(SerializedEffectSchema)),
    characters: v.exactOptional(v.string()),
    fontSize: v.exactOptional(v.union([v.number(), v.literal(MIXED)])),
    fontName: v.exactOptional(v.union([SerializedFontNameSchema, v.literal(MIXED)])),
    styleIds: v.exactOptional(SerializedStyleIdsSchema),
    boundVariables: v.exactOptional(v.record(v.string(), v.array(v.string()))),
    componentProperties: v.exactOptional(v.record(v.string(), SerializedComponentPropertySchema)),
    mainComponent: v.exactOptional(SerializedMainComponentSchema),
    mainComponentId: v.exactOptional(v.string()),
    fill: v.exactOptional(v.string()),
    stroke: v.exactOptional(v.string()),
    effect: v.exactOptional(v.string()),
    textStyle: v.exactOptional(v.string()),
    deduped: v.exactOptional(v.boolean()),
    truncated: v.exactOptional(v.boolean()),
    children: v.exactOptional(v.array(DesignContextNodeSchema)),
  }),
);

/**
 * A resolved design-system token: the human name a node's `styleIds` / `boundVariables` id points
 * to (e.g. `Primary/500`, `size/sm`, `Body/Bold`) plus its kind. Resolution is deduped into the
 * top-level `variables` / `styles` maps so a token referenced by 100 nodes costs one entry —
 * nodes keep the id, the consumer joins id → name. The node's own inline value (fill color,
 * fontSize, …) remains the fallback when a ref is unresolved (e.g. a library var not subscribed).
 */
export const ResolvedTokenSchema = v.object({
  name: v.string(),
  type: v.string(),
});
export type ResolvedToken = v.InferOutput<typeof ResolvedTokenSchema>;

/**
 * Deduplicated style table (P3). Keys are content-hash ids (`fill_AB12CD`, `text_9F3K2L`) so the
 * same style always maps to the same id — output is stable across runs and diffable (unlike
 * Framelink's random ids). Values are opaque style bundles (paint arrays / typography); the
 * consumer renders them per profile (Tailwind class / CSS var / …) via an adapter.
 */
export const GlobalVarsSchema = v.object({
  styles: v.record(v.string(), v.unknown()),
});
export type GlobalVars = v.InferOutput<typeof GlobalVarsSchema>;

/** Quantifies the simplification — chiefly the dedup win (inline vs deduped byte size). */
export const DesignContextMetricsSchema = v.object({
  nodeCount: v.number(),
  maxDepth: v.number(),
  styleCount: v.number(),
  tokenCount: v.number(),
  inlineSizeKb: v.number(),
  dedupedSizeKb: v.number(),
});
export type DesignContextMetrics = v.InferOutput<typeof DesignContextMetricsSchema>;

export const GetDesignContextResultSchema = v.object({
  nodes: v.array(DesignContextNodeSchema),
  /** Deduplicated style table; nodes carry `fill` / `textStyle` refs into it. Full detail only. */
  globalVars: v.exactOptional(GlobalVarsSchema),
  /** id → token, for variable ids referenced by any node's `boundVariables`. Omitted when empty. */
  variables: v.exactOptional(v.record(v.string(), ResolvedTokenSchema)),
  /** id → token, for shared-style ids referenced by any node's `styleIds`. Omitted when empty. */
  styles: v.exactOptional(v.record(v.string(), ResolvedTokenSchema)),
  /** Simplification metrics; full detail only. */
  metrics: v.exactOptional(DesignContextMetricsSchema),
});
export type GetDesignContextResult = v.InferOutput<typeof GetDesignContextResultSchema>;
