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

/**
 * IMAGE / VIDEO / PATTERN / SHADER. scaleMode (the object-fit equivalent: FILL=cover, FIT=contain,
 * CROP, TILE=repeat) is carried for IMAGE/VIDEO so an exported image gets the right fit; the raster
 * bytes themselves stay out of scope (exported separately via get_screenshot). PATTERN and SHADER
 * (a procedural fill) carry no scaleMode — we emit only the type marker so the fill isn't silently
 * dropped from codegen, since neither has a meaningful CSS translation.
 */
const OtherPaintSchema = z.object({
  type: z.enum(['IMAGE', 'VIDEO', 'PATTERN', 'SHADER']),
  visible: z.boolean(),
  opacity: z.number(),
  scaleMode: z.enum(['FILL', 'FIT', 'CROP', 'TILE']).optional(),
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

/** One grid track (a row or column) in a GRID auto-layout: FLEX (fr fraction) or FIXED (px). */
export const SerializedGridTrackSchema = z.object({
  type: z.string(), // FLEX | FIXED
  value: z.number(),
});
export type SerializedGridTrack = z.infer<typeof SerializedGridTrackSchema>;

/**
 * Auto Layout summary (present when layoutMode is HORIZONTAL / VERTICAL / GRID). padding is common
 * to all three. H/V carry itemSpacing + primary/counterAxisAlignItems (→ flex gap + justify/align);
 * GRID carries gridRow/ColumnCount + gridRow/ColumnGap + track sizes instead (→ CSS Grid).
 */
export const SerializedAutoLayoutSchema = z.object({
  mode: z.enum(['HORIZONTAL', 'VERTICAL', 'GRID']),
  paddingTop: z.number(),
  paddingRight: z.number(),
  paddingBottom: z.number(),
  paddingLeft: z.number(),
  // HORIZONTAL / VERTICAL only
  itemSpacing: z.number().optional(),
  primaryAxisAlignItems: z.string().optional(),
  counterAxisAlignItems: z.string().optional(),
  layoutWrap: z.string().optional(),
  // GRID only
  gridRowCount: z.number().optional(),
  gridColumnCount: z.number().optional(),
  gridRowGap: z.number().optional(),
  gridColumnGap: z.number().optional(),
  gridRowSizes: z.array(SerializedGridTrackSchema).optional(),
  gridColumnSizes: z.array(SerializedGridTrackSchema).optional(),
});
export type SerializedAutoLayout = z.infer<typeof SerializedAutoLayoutSchema>;

/**
 * A child's placement inside a GRID auto-layout parent (only emitted when the parent's layoutMode
 * is GRID and the child carries non-default placement). anchor index is 0-based and present only
 * when the child is pinned to a specific cell (auto-flowed children have anchor -1 → omitted); span
 * is present only when > 1; align only when not AUTO. The whole object is omitted for a plain
 * auto-flowed cell. Maps to CSS Grid `grid-row` / `grid-column` (anchor+1 / span) + `justify-self`
 * / `align-self`.
 */
export const SerializedGridChildSchema = z.object({
  rowAnchorIndex: z.number().optional(),
  columnAnchorIndex: z.number().optional(),
  rowSpan: z.number().optional(),
  columnSpan: z.number().optional(),
  horizontalAlign: z.string().optional(),
  verticalAlign: z.string().optional(),
});
export type SerializedGridChild = z.infer<typeof SerializedGridChildSchema>;

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
  // When the main component is a variant (child of a COMPONENT_SET), `name` is the variant signature
  // ("Size=Large, State=Hover") — useless for reuse. These carry the owning set's identity so a
  // consumer can group/name by the set ("Button") without a doc-wide scan. Absent for standalone
  // components (no set parent).
  componentSetId: z.string().optional(),
  componentSetName: z.string().optional(),
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
  /**
   * Per-corner radii, only when cornerRadius is `mixed` (the corners differ). Maps to
   * border-top-left-radius / …; cards rounded on one side, tabs, chat bubbles and segmented
   * controls all use uneven corners, and collapsing to a single `mixed` loses which corners round.
   */
  cornerRadii?: { topLeft: number; topRight: number; bottomRight: number; bottomLeft: number };
  /** Layer blend mode (e.g. MULTIPLY / SCREEN / OVERLAY); omitted/`PASS_THROUGH` when normal. */
  blendMode?: string;
  /** True when this node clips its later siblings (a mask) — its fill defines the visible shape. */
  isMask?: boolean;
  /** How the mask clips: ALPHA / LUMINANCE / GEOMETRY (only meaningful when isMask). */
  maskType?: string;
  /**
   * Ellipse arc geometry (EllipseNode only) → a pie slice / gauge (partial sweep) or a ring / donut
   * (non-zero innerRadius). Omitted for a plain full disc, so a solid circle stays clean. Angles
   * are in radians; innerRadius is 0–1 of the outer radius. Round-trips with set_arc.
   */
  arcData?: { startingAngle: number; endingAngle: number; innerRadius: number };
  fills?: readonly SerializedPaint[] | Mixed;
  strokes?: readonly SerializedPaint[];
  strokeWeight?: number | Mixed;
  /**
   * Per-side stroke weights, only when strokeWeight is `mixed` (the sides differ). A side with 0
   * has no border; non-zero sides map to border-t / border-r / border-b / border-l.
   */
  strokeWeights?: { top: number; right: number; bottom: number; left: number };
  strokeAlign?: string;
  effects?: readonly SerializedEffect[];
  layout?: SerializedAutoLayout;
  // how this node sizes/positions itself inside an auto-layout parent
  layoutSizingHorizontal?: string;
  layoutSizingVertical?: string;
  layoutGrow?: number;
  layoutAlign?: string;
  layoutPositioning?: string;
  /** Placement inside a GRID auto-layout parent (only when the parent's layoutMode is GRID). */
  gridChild?: SerializedGridChild;
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
    cornerRadii: z
      .object({
        topLeft: z.number(),
        topRight: z.number(),
        bottomRight: z.number(),
        bottomLeft: z.number(),
      })
      .optional(),
    blendMode: z.string().optional(),
    isMask: z.boolean().optional(),
    maskType: z.string().optional(),
    arcData: z
      .object({
        startingAngle: z.number(),
        endingAngle: z.number(),
        innerRadius: z.number(),
      })
      .optional(),
    fills: z.union([z.array(SerializedPaintSchema), z.literal(MIXED)]).optional(),
    strokes: z.array(SerializedPaintSchema).optional(),
    strokeWeight: z.union([z.number(), z.literal(MIXED)]).optional(),
    strokeWeights: z
      .object({
        top: z.number(),
        right: z.number(),
        bottom: z.number(),
        left: z.number(),
      })
      .optional(),
    strokeAlign: z.string().optional(),
    effects: z.array(SerializedEffectSchema).optional(),
    layout: SerializedAutoLayoutSchema.optional(),
    layoutSizingHorizontal: z.string().optional(),
    layoutSizingVertical: z.string().optional(),
    layoutGrow: z.number().optional(),
    layoutAlign: z.string().optional(),
    layoutPositioning: z.string().optional(),
    gridChild: SerializedGridChildSchema.optional(),
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
