import * as v from 'valibot';

import { MIXED, SerializedFontNameSchema, SerializedPaintSchema } from './serialized-node.js';

export const DETAIL_LEVELS = ['minimal', 'compact', 'full'] as const;
export type DetailLevel = (typeof DETAIL_LEVELS)[number];

/**
 * Token-efficient, depth-limited tree node for LLM exploration. Fields populate by detail level:
 * - minimal: id / name / type
 * - compact: + visible / x / y / width / height
 * - full: + rotation / opacity / cornerRadius / fills / text mixin
 * `truncated` marks children dropped at the depth limit; `deduped` marks an instance whose main
 * component was already expanded (its children are omitted), with `mainComponentId` for cross-ref.
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
