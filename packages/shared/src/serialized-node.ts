import { z } from 'zod';

export const MIXED = 'mixed' as const;
export type Mixed = typeof MIXED;

export const SerializedColorSchema = z.object({
  r: z.number(),
  g: z.number(),
  b: z.number(),
});
export type SerializedColor = z.infer<typeof SerializedColorSchema>;

/** RGBA color (effects / variable color values carry alpha). RGB inputs are normalised to a=1. */
export const SerializedRGBASchema = z.object({
  r: z.number(),
  g: z.number(),
  b: z.number(),
  a: z.number(),
});
export type SerializedRGBA = z.infer<typeof SerializedRGBASchema>;

const SolidPaintSchema = z.object({
  type: z.literal('SOLID'),
  visible: z.boolean(),
  opacity: z.number(),
  color: SerializedColorSchema,
});

/** A gradient color stop: position 0–1 along the gradient + its RGBA color. */
export const SerializedColorStopSchema = z.object({
  position: z.number(),
  color: SerializedRGBASchema,
});
export type SerializedColorStop = z.infer<typeof SerializedColorStopSchema>;

/**
 * Gradient paint. `gradientTransform` is the Figma Plugin API's 2×3 affine matrix (rows of 3) that
 * positions the gradient — it round-trips directly into write tools (unlike the REST API's
 * gradientHandlePositions, which we don't use plugin-side).
 */
const GradientPaintSchema = z.object({
  type: z.enum(['GRADIENT_LINEAR', 'GRADIENT_RADIAL', 'GRADIENT_ANGULAR', 'GRADIENT_DIAMOND']),
  visible: z.boolean(),
  opacity: z.number(),
  gradientStops: z.array(SerializedColorStopSchema),
  gradientTransform: z.array(z.array(z.number())),
});

/** IMAGE / VIDEO / PATTERN: type-only for now (raster/pattern detail is out of scope). */
const OtherPaintSchema = z.object({
  type: z.enum(['IMAGE', 'VIDEO', 'PATTERN']),
  visible: z.boolean(),
  opacity: z.number(),
});

export const SerializedPaintSchema = z.discriminatedUnion('type', [
  SolidPaintSchema,
  GradientPaintSchema,
  OtherPaintSchema,
]);
export type SerializedPaint = z.infer<typeof SerializedPaintSchema>;

export const SerializedFontNameSchema = z.object({
  family: z.string(),
  style: z.string(),
});
export type SerializedFontName = z.infer<typeof SerializedFontNameSchema>;

/**
 * Bounded effect wire-format: shadows carry color / offset / spread; blurs & textures carry radius;
 * noise / glass carry only type + visible. `type` is the Figma effect type literal. (Lives here,
 * not in styles.ts, so both node serialization and style serialization can share it.)
 */
export const SerializedEffectSchema = z.object({
  type: z.string(),
  visible: z.boolean(),
  radius: z.number().optional(),
  color: SerializedRGBASchema.optional(),
  offset: z.object({ x: z.number(), y: z.number() }).optional(),
  spread: z.number().optional(),
});
export type SerializedEffect = z.infer<typeof SerializedEffectSchema>;

/** `pattern` is ROWS / COLUMNS / GRID; column/row grids add count / gutterSize / alignment. */
export const SerializedLayoutGridSchema = z.object({
  pattern: z.string(),
  visible: z.boolean(),
  sectionSize: z.number().optional(),
  count: z.number().optional(),
  gutterSize: z.number().optional(),
  alignment: z.string().optional(),
});
export type SerializedLayoutGrid = z.infer<typeof SerializedLayoutGridSchema>;

/** Auto Layout summary (only present when a node's layoutMode is HORIZONTAL / VERTICAL). */
export const SerializedAutoLayoutSchema = z.object({
  mode: z.enum(['HORIZONTAL', 'VERTICAL']),
  paddingTop: z.number(),
  paddingRight: z.number(),
  paddingBottom: z.number(),
  paddingLeft: z.number(),
  itemSpacing: z.number(),
  primaryAxisAlignItems: z.string(),
  counterAxisAlignItems: z.string(),
  layoutWrap: z.string().optional(),
});
export type SerializedAutoLayout = z.infer<typeof SerializedAutoLayoutSchema>;

/**
 * Non-auto-layout positioning constraints (horizontal / vertical), e.g. MIN / CENTER / STRETCH /
 * SCALE.
 */
export const SerializedConstraintsSchema = z.object({
  horizontal: z.string(),
  vertical: z.string(),
});
export type SerializedConstraints = z.infer<typeof SerializedConstraintsSchema>;

/** Unit is PIXELS / PERCENT / AUTO; AUTO omits value. (Shared by node + text-style serialization.) */
export const SerializedLineHeightSchema = z.object({
  unit: z.string(),
  value: z.number().optional(),
});
export type SerializedLineHeight = z.infer<typeof SerializedLineHeightSchema>;

export const SerializedLetterSpacingSchema = z.object({
  unit: z.string(),
  value: z.number(),
});
export type SerializedLetterSpacing = z.infer<typeof SerializedLetterSpacingSchema>;

/** Bound shared-style ids (link a node to design-system styles → tokens for codegen). */
export const SerializedStyleIdsSchema = z.object({
  fill: z.string().optional(),
  stroke: z.string().optional(),
  effect: z.string().optional(),
  text: z.string().optional(),
});
export type SerializedStyleIds = z.infer<typeof SerializedStyleIdsSchema>;

/** One instance component property (variant / boolean / text / instance-swap). */
export const SerializedComponentPropertySchema = z.object({
  type: z.string(),
  value: z.union([z.string(), z.boolean()]),
});
export type SerializedComponentProperty = z.infer<typeof SerializedComponentPropertySchema>;

/** The main component an INSTANCE points to (lets codegen map the instance to a library component). */
export const SerializedMainComponentSchema = z.object({
  id: z.string(),
  name: z.string(),
  key: z.string(),
});
export type SerializedMainComponent = z.infer<typeof SerializedMainComponentSchema>;

/** A run of uniformly-styled characters within a mixed-style TEXT node (→ inline spans / links). */
export const SerializedTextSegmentSchema = z.object({
  characters: z.string(),
  start: z.number(),
  end: z.number(),
  fontName: SerializedFontNameSchema,
  fontSize: z.number(),
  fills: z.array(SerializedPaintSchema),
  textDecoration: z.string(),
  textCase: z.string(),
});
export type SerializedTextSegment = z.infer<typeof SerializedTextSegmentSchema>;

export interface SerializedNode {
  id: string;
  name: string;
  type: string;
  visible: boolean;
  locked: boolean;
  parentId: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  opacity?: number;
  cornerRadius?: number | Mixed;
  fills?: readonly SerializedPaint[] | Mixed;
  strokes?: readonly SerializedPaint[];
  strokeWeight?: number | Mixed;
  strokeAlign?: string;
  effects?: readonly SerializedEffect[];
  layout?: SerializedAutoLayout;
  // how this node sizes/positions itself inside an auto-layout parent
  layoutSizingHorizontal?: string;
  layoutSizingVertical?: string;
  layoutGrow?: number;
  layoutAlign?: string;
  layoutPositioning?: string;
  // non-auto-layout positioning
  constraints?: SerializedConstraints;
  clipsContent?: boolean;
  // design-system links (→ tokens / shared styles for codegen)
  styleIds?: SerializedStyleIds;
  boundVariables?: Readonly<Record<string, readonly string[]>>;
  // instance variant / props + which component it instantiates
  componentProperties?: Readonly<Record<string, SerializedComponentProperty>>;
  mainComponent?: SerializedMainComponent;
  // text typography
  characters?: string;
  fontSize?: number | Mixed;
  fontName?: SerializedFontName | Mixed;
  textAlignHorizontal?: string;
  textAlignVertical?: string;
  lineHeight?: SerializedLineHeight | Mixed;
  letterSpacing?: SerializedLetterSpacing | Mixed;
  textCase?: string | Mixed;
  textDecoration?: string | Mixed;
  textAutoResize?: string;
  textTruncation?: string;
  maxLines?: number | null;
  paragraphSpacing?: number;
  paragraphIndent?: number;
  /** Present only for mixed-style TEXT: per-run styling so rich text isn't flattened. */
  segments?: readonly SerializedTextSegment[];
  children?: readonly SerializedNode[];
}

// Cast through unknown: zod's .optional() outputs `T | undefined`, while SerializedNode uses bare
// optional (`rotation?: number`) under exactOptionalPropertyTypes. Functionally identical at runtime.
export const SerializedNodeSchema = z.lazy(() =>
  z.object({
    id: z.string(),
    name: z.string(),
    type: z.string(),
    visible: z.boolean(),
    locked: z.boolean(),
    parentId: z.string().nullable(),
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
    rotation: z.number().optional(),
    opacity: z.number().optional(),
    cornerRadius: z.union([z.number(), z.literal(MIXED)]).optional(),
    fills: z.union([z.array(SerializedPaintSchema), z.literal(MIXED)]).optional(),
    strokes: z.array(SerializedPaintSchema).optional(),
    strokeWeight: z.union([z.number(), z.literal(MIXED)]).optional(),
    strokeAlign: z.string().optional(),
    effects: z.array(SerializedEffectSchema).optional(),
    layout: SerializedAutoLayoutSchema.optional(),
    layoutSizingHorizontal: z.string().optional(),
    layoutSizingVertical: z.string().optional(),
    layoutGrow: z.number().optional(),
    layoutAlign: z.string().optional(),
    layoutPositioning: z.string().optional(),
    constraints: SerializedConstraintsSchema.optional(),
    clipsContent: z.boolean().optional(),
    styleIds: SerializedStyleIdsSchema.optional(),
    boundVariables: z.record(z.string(), z.array(z.string())).optional(),
    componentProperties: z.record(z.string(), SerializedComponentPropertySchema).optional(),
    mainComponent: SerializedMainComponentSchema.optional(),
    characters: z.string().optional(),
    fontSize: z.union([z.number(), z.literal(MIXED)]).optional(),
    fontName: z.union([SerializedFontNameSchema, z.literal(MIXED)]).optional(),
    textAlignHorizontal: z.string().optional(),
    textAlignVertical: z.string().optional(),
    lineHeight: z.union([SerializedLineHeightSchema, z.literal(MIXED)]).optional(),
    letterSpacing: z.union([SerializedLetterSpacingSchema, z.literal(MIXED)]).optional(),
    textCase: z.union([z.string(), z.literal(MIXED)]).optional(),
    textDecoration: z.union([z.string(), z.literal(MIXED)]).optional(),
    textAutoResize: z.string().optional(),
    textTruncation: z.string().optional(),
    maxLines: z.number().nullable().optional(),
    paragraphSpacing: z.number().optional(),
    paragraphIndent: z.number().optional(),
    segments: z.array(SerializedTextSegmentSchema).optional(),
    children: z.array(SerializedNodeSchema).optional(),
  }),
) as unknown as z.ZodType<SerializedNode>;

export interface SceneNodeLike {
  id: string;
  name: string;
  type: string;
  visible: boolean;
  locked: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  parent: { id: string } | null;
}

export const serializeNode = (node: SceneNodeLike): SerializedNode => ({
  id: node.id,
  name: node.name,
  type: node.type,
  visible: node.visible,
  locked: node.locked,
  x: node.x,
  y: node.y,
  width: node.width,
  height: node.height,
  parentId: node.parent === null ? null : node.parent.id,
});

export const GetSelectionResultSchema = z.object({
  pageId: z.string(),
  pageName: z.string(),
  nodes: z.array(SerializedNodeSchema),
});
export type GetSelectionResult = z.infer<typeof GetSelectionResultSchema>;

export const GetDocumentResultSchema = z.object({
  pageId: z.string(),
  pageName: z.string(),
  children: z.array(SerializedNodeSchema),
});
export type GetDocumentResult = z.infer<typeof GetDocumentResultSchema>;

export const PageRefSchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type PageRef = z.infer<typeof PageRefSchema>;

export const GetNodeResultSchema = z.object({
  node: SerializedNodeSchema.nullable(),
});
export type GetNodeResult = z.infer<typeof GetNodeResultSchema>;

export const GetNodesInfoResultSchema = z.object({
  nodes: z.array(SerializedNodeSchema.nullable()),
});
export type GetNodesInfoResult = z.infer<typeof GetNodesInfoResultSchema>;

export const GetMetadataResultSchema = z.object({
  fileName: z.string(),
  currentPage: PageRefSchema,
  pages: z.array(PageRefSchema),
});
export type GetMetadataResult = z.infer<typeof GetMetadataResultSchema>;

export const GetPagesResultSchema = z.object({
  pages: z.array(PageRefSchema),
});
export type GetPagesResult = z.infer<typeof GetPagesResultSchema>;

/** Shared shape for the tree-traversal tools: a flat array of matching nodes. */
export const NodeListResultSchema = z.object({
  nodes: z.array(SerializedNodeSchema),
});
export type SearchNodesResult = z.infer<typeof NodeListResultSchema>;
export type ScanTextNodesResult = z.infer<typeof NodeListResultSchema>;
export type ScanNodesByTypesResult = z.infer<typeof NodeListResultSchema>;
