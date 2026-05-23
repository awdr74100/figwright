import * as v from 'valibot';

export const MIXED = 'mixed' as const;
export type Mixed = typeof MIXED;

export const SerializedColorSchema = v.object({
  r: v.number(),
  g: v.number(),
  b: v.number(),
});
export type SerializedColor = v.InferOutput<typeof SerializedColorSchema>;

/** RGBA color (effects / variable color values carry alpha). RGB inputs are normalised to a=1. */
export const SerializedRGBASchema = v.object({
  r: v.number(),
  g: v.number(),
  b: v.number(),
  a: v.number(),
});
export type SerializedRGBA = v.InferOutput<typeof SerializedRGBASchema>;

const SolidPaintSchema = v.object({
  type: v.literal('SOLID'),
  visible: v.boolean(),
  opacity: v.number(),
  color: SerializedColorSchema,
});

const NonSolidPaintSchema = v.object({
  type: v.picklist([
    'GRADIENT_LINEAR',
    'GRADIENT_RADIAL',
    'GRADIENT_ANGULAR',
    'GRADIENT_DIAMOND',
    'IMAGE',
    'VIDEO',
    'PATTERN',
  ]),
  visible: v.boolean(),
  opacity: v.number(),
});

export const SerializedPaintSchema = v.variant('type', [SolidPaintSchema, NonSolidPaintSchema]);
export type SerializedPaint = v.InferOutput<typeof SerializedPaintSchema>;

export const SerializedFontNameSchema = v.object({
  family: v.string(),
  style: v.string(),
});
export type SerializedFontName = v.InferOutput<typeof SerializedFontNameSchema>;

/**
 * Bounded effect wire-format: shadows carry color / offset / spread; blurs & textures carry radius;
 * noise / glass carry only type + visible. `type` is the Figma effect type literal.
 * (Lives here, not in styles.ts, so both node serialization and style serialization can share it.)
 */
export const SerializedEffectSchema = v.object({
  type: v.string(),
  visible: v.boolean(),
  radius: v.exactOptional(v.number()),
  color: v.exactOptional(SerializedRGBASchema),
  offset: v.exactOptional(v.object({ x: v.number(), y: v.number() })),
  spread: v.exactOptional(v.number()),
});
export type SerializedEffect = v.InferOutput<typeof SerializedEffectSchema>;

/** `pattern` is ROWS / COLUMNS / GRID; column/row grids add count / gutterSize / alignment. */
export const SerializedLayoutGridSchema = v.object({
  pattern: v.string(),
  visible: v.boolean(),
  sectionSize: v.exactOptional(v.number()),
  count: v.exactOptional(v.number()),
  gutterSize: v.exactOptional(v.number()),
  alignment: v.exactOptional(v.string()),
});
export type SerializedLayoutGrid = v.InferOutput<typeof SerializedLayoutGridSchema>;

/** Auto Layout summary (only present when a node's layoutMode is HORIZONTAL / VERTICAL). */
export const SerializedAutoLayoutSchema = v.object({
  mode: v.picklist(['HORIZONTAL', 'VERTICAL']),
  paddingTop: v.number(),
  paddingRight: v.number(),
  paddingBottom: v.number(),
  paddingLeft: v.number(),
  itemSpacing: v.number(),
  primaryAxisAlignItems: v.string(),
  counterAxisAlignItems: v.string(),
  layoutWrap: v.exactOptional(v.string()),
});
export type SerializedAutoLayout = v.InferOutput<typeof SerializedAutoLayoutSchema>;

/** Non-auto-layout positioning constraints (horizontal / vertical), e.g. MIN / CENTER / STRETCH / SCALE. */
export const SerializedConstraintsSchema = v.object({
  horizontal: v.string(),
  vertical: v.string(),
});
export type SerializedConstraints = v.InferOutput<typeof SerializedConstraintsSchema>;

/** unit is PIXELS / PERCENT / AUTO; AUTO omits value. (Shared by node + text-style serialization.) */
export const SerializedLineHeightSchema = v.object({
  unit: v.string(),
  value: v.exactOptional(v.number()),
});
export type SerializedLineHeight = v.InferOutput<typeof SerializedLineHeightSchema>;

export const SerializedLetterSpacingSchema = v.object({
  unit: v.string(),
  value: v.number(),
});
export type SerializedLetterSpacing = v.InferOutput<typeof SerializedLetterSpacingSchema>;

/** Bound shared-style ids (link a node to design-system styles → tokens for codegen). */
export const SerializedStyleIdsSchema = v.object({
  fill: v.exactOptional(v.string()),
  stroke: v.exactOptional(v.string()),
  effect: v.exactOptional(v.string()),
  text: v.exactOptional(v.string()),
});
export type SerializedStyleIds = v.InferOutput<typeof SerializedStyleIdsSchema>;

/** One instance component property (variant / boolean / text / instance-swap). */
export const SerializedComponentPropertySchema = v.object({
  type: v.string(),
  value: v.union([v.string(), v.boolean()]),
});
export type SerializedComponentProperty = v.InferOutput<typeof SerializedComponentPropertySchema>;

/** The main component an INSTANCE points to (lets codegen map the instance to a library component). */
export const SerializedMainComponentSchema = v.object({
  id: v.string(),
  name: v.string(),
  key: v.string(),
});
export type SerializedMainComponent = v.InferOutput<typeof SerializedMainComponentSchema>;

/** A run of uniformly-styled characters within a mixed-style TEXT node (→ inline spans / links). */
export const SerializedTextSegmentSchema = v.object({
  characters: v.string(),
  start: v.number(),
  end: v.number(),
  fontName: SerializedFontNameSchema,
  fontSize: v.number(),
  fills: v.array(SerializedPaintSchema),
  textDecoration: v.string(),
  textCase: v.string(),
});
export type SerializedTextSegment = v.InferOutput<typeof SerializedTextSegmentSchema>;

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
  /** Present only for mixed-style TEXT: per-run styling so rich text isn't flattened. */
  segments?: readonly SerializedTextSegment[];
  children?: readonly SerializedNode[];
}

export const SerializedNodeSchema: v.GenericSchema<SerializedNode> = v.lazy(() =>
  v.object({
    id: v.string(),
    name: v.string(),
    type: v.string(),
    visible: v.boolean(),
    locked: v.boolean(),
    parentId: v.nullable(v.string()),
    x: v.number(),
    y: v.number(),
    width: v.number(),
    height: v.number(),
    rotation: v.exactOptional(v.number()),
    opacity: v.exactOptional(v.number()),
    cornerRadius: v.exactOptional(v.union([v.number(), v.literal(MIXED)])),
    fills: v.exactOptional(v.union([v.array(SerializedPaintSchema), v.literal(MIXED)])),
    strokes: v.exactOptional(v.array(SerializedPaintSchema)),
    strokeWeight: v.exactOptional(v.union([v.number(), v.literal(MIXED)])),
    strokeAlign: v.exactOptional(v.string()),
    effects: v.exactOptional(v.array(SerializedEffectSchema)),
    layout: v.exactOptional(SerializedAutoLayoutSchema),
    layoutSizingHorizontal: v.exactOptional(v.string()),
    layoutSizingVertical: v.exactOptional(v.string()),
    layoutGrow: v.exactOptional(v.number()),
    layoutAlign: v.exactOptional(v.string()),
    layoutPositioning: v.exactOptional(v.string()),
    constraints: v.exactOptional(SerializedConstraintsSchema),
    clipsContent: v.exactOptional(v.boolean()),
    styleIds: v.exactOptional(SerializedStyleIdsSchema),
    boundVariables: v.exactOptional(v.record(v.string(), v.array(v.string()))),
    componentProperties: v.exactOptional(v.record(v.string(), SerializedComponentPropertySchema)),
    mainComponent: v.exactOptional(SerializedMainComponentSchema),
    characters: v.exactOptional(v.string()),
    fontSize: v.exactOptional(v.union([v.number(), v.literal(MIXED)])),
    fontName: v.exactOptional(v.union([SerializedFontNameSchema, v.literal(MIXED)])),
    textAlignHorizontal: v.exactOptional(v.string()),
    textAlignVertical: v.exactOptional(v.string()),
    lineHeight: v.exactOptional(v.union([SerializedLineHeightSchema, v.literal(MIXED)])),
    letterSpacing: v.exactOptional(v.union([SerializedLetterSpacingSchema, v.literal(MIXED)])),
    textCase: v.exactOptional(v.union([v.string(), v.literal(MIXED)])),
    textDecoration: v.exactOptional(v.union([v.string(), v.literal(MIXED)])),
    segments: v.exactOptional(v.array(SerializedTextSegmentSchema)),
    children: v.exactOptional(v.array(SerializedNodeSchema)),
  }),
);

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

export const GetSelectionResultSchema = v.object({
  pageId: v.string(),
  pageName: v.string(),
  nodes: v.array(SerializedNodeSchema),
});
export type GetSelectionResult = v.InferOutput<typeof GetSelectionResultSchema>;

export const GetDocumentResultSchema = v.object({
  pageId: v.string(),
  pageName: v.string(),
  children: v.array(SerializedNodeSchema),
});
export type GetDocumentResult = v.InferOutput<typeof GetDocumentResultSchema>;

export const PageRefSchema = v.object({
  id: v.string(),
  name: v.string(),
});
export type PageRef = v.InferOutput<typeof PageRefSchema>;

export const GetNodeResultSchema = v.object({
  node: v.nullable(SerializedNodeSchema),
});
export type GetNodeResult = v.InferOutput<typeof GetNodeResultSchema>;

export const GetNodesInfoResultSchema = v.object({
  nodes: v.array(v.nullable(SerializedNodeSchema)),
});
export type GetNodesInfoResult = v.InferOutput<typeof GetNodesInfoResultSchema>;

export const GetMetadataResultSchema = v.object({
  fileName: v.string(),
  currentPage: PageRefSchema,
  pages: v.array(PageRefSchema),
});
export type GetMetadataResult = v.InferOutput<typeof GetMetadataResultSchema>;

export const GetPagesResultSchema = v.object({
  pages: v.array(PageRefSchema),
});
export type GetPagesResult = v.InferOutput<typeof GetPagesResultSchema>;

/** Shared shape for the tree-traversal tools: a flat array of matching nodes. */
export const NodeListResultSchema = v.object({
  nodes: v.array(SerializedNodeSchema),
});
export type SearchNodesResult = v.InferOutput<typeof NodeListResultSchema>;
export type ScanTextNodesResult = v.InferOutput<typeof NodeListResultSchema>;
export type ScanNodesByTypesResult = v.InferOutput<typeof NodeListResultSchema>;
