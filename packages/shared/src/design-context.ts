import * as v from 'valibot';

import {
  MIXED,
  SerializedComponentPropertySchema,
  SerializedFontNameSchema,
  SerializedMainComponentSchema,
  SerializedPaintSchema,
  SerializedStyleIdsSchema,
} from './serialized-node.js';
import type {
  SerializedComponentProperty,
  SerializedMainComponent,
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
  characters?: string;
  fontSize?: number | typeof MIXED;
  fontName?: v.InferOutput<typeof SerializedFontNameSchema> | typeof MIXED;
  styleIds?: SerializedStyleIds;
  boundVariables?: Readonly<Record<string, readonly string[]>>;
  componentProperties?: Readonly<Record<string, SerializedComponentProperty>>;
  mainComponent?: SerializedMainComponent;
  mainComponentId?: string;
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
    characters: v.exactOptional(v.string()),
    fontSize: v.exactOptional(v.union([v.number(), v.literal(MIXED)])),
    fontName: v.exactOptional(v.union([SerializedFontNameSchema, v.literal(MIXED)])),
    styleIds: v.exactOptional(SerializedStyleIdsSchema),
    boundVariables: v.exactOptional(v.record(v.string(), v.array(v.string()))),
    componentProperties: v.exactOptional(v.record(v.string(), SerializedComponentPropertySchema)),
    mainComponent: v.exactOptional(SerializedMainComponentSchema),
    mainComponentId: v.exactOptional(v.string()),
    deduped: v.exactOptional(v.boolean()),
    truncated: v.exactOptional(v.boolean()),
    children: v.exactOptional(v.array(DesignContextNodeSchema)),
  }),
);

export const GetDesignContextResultSchema = v.object({
  nodes: v.array(DesignContextNodeSchema),
});
export type GetDesignContextResult = v.InferOutput<typeof GetDesignContextResultSchema>;
