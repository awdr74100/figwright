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
 * IMAGE / VIDEO / SHADER. scaleMode (the object-fit equivalent: FILL=cover, FIT=contain, CROP,
 * TILE=repeat) is carried for IMAGE/VIDEO so an exported image gets the right fit; the raster bytes
 * themselves stay out of scope (exported separately via get_screenshot). SHADER is a procedural
 * fill with no scaleMode and no meaningful CSS translation — we emit only the type marker so it
 * isn't silently dropped. (PATTERN has its own schema below; it carries the tiling geometry.)
 */
const OtherPaintSchema = z.object({
  type: z.enum(['IMAGE', 'VIDEO', 'SHADER']),
  visible: z.boolean(),
  opacity: z.number(),
  scaleMode: z.enum(['FILL', 'FIT', 'CROP', 'TILE']).optional(),
  /**
   * True when the fill carries non-zero image adjustments (exposure / contrast / saturation /
   * temperature / tint / highlights / shadows). The original bytes (save_image_fills) do NOT
   * include them, so an adjusted image must ship as the composited render (get_screenshot), or the
   * colour grading is silently lost. Omitted when untouched.
   */
  filtersApplied: z.boolean().optional(),
});

/**
 * PATTERN — a source node tiled across the fill (a newer Figma feature). The tile artwork itself
 * lives at `sourceNodeId` and is exported separately (like a raster) via get_screenshot; we carry
 * the geometry needed to reconstruct the tiling in code. `spacing` (0,0) and `horizontalAlignment`
 * 'START' are the no-op defaults, omitted by the serializer to keep the payload lean.
 */
const PatternPaintSchema = z.object({
  type: z.literal('PATTERN'),
  visible: z.boolean(),
  opacity: z.number(),
  sourceNodeId: z.string(),
  tileType: z.enum(['RECTANGULAR', 'HORIZONTAL_HEXAGONAL', 'VERTICAL_HEXAGONAL']),
  scalingFactor: z.number(),
  spacing: z.object({ x: z.number(), y: z.number() }).optional(),
  horizontalAlignment: z.enum(['START', 'CENTER', 'END']).optional(),
});

export const SerializedPaintSchema = z.discriminatedUnion('type', [
  SolidPaintSchema,
  GradientPaintSchema,
  OtherPaintSchema,
  PatternPaintSchema,
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

/**
 * One Dev Mode annotation: the designer's note written for the developer. Lives here (not in
 * queries.ts, which imports from this module) so node serialization can embed annotations on
 * SerializedNode while get_annotations keeps returning the same shape.
 */
export const SerializedAnnotationSchema = z.object({
  label: z.string().optional(),
  labelMarkdown: z.string().optional(),
  categoryId: z.string().optional(),
  /** The annotation's pinned property names, e.g. ["fills", "cornerRadius"]. */
  properties: z.array(z.string()).optional(),
});
export type SerializedAnnotation = z.infer<typeof SerializedAnnotationSchema>;

/**
 * `pattern` is ROWS / COLUMNS / GRID; column/row grids add count / gutterSize / alignment / offset.
 * `offset` is the margin between the grid and the frame edge — the responsive container's
 * horizontal page margin (→ container padding); omitted when 0 or when alignment is CENTER (which
 * ignores it).
 */
export const SerializedLayoutGridSchema = z.object({
  pattern: z.string(),
  visible: z.boolean(),
  sectionSize: z.number().optional(),
  count: z.number().optional(),
  gutterSize: z.number().optional(),
  alignment: z.string().optional(),
  offset: z.number().optional(),
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
  // WRAP only: gap between wrapped lines (cross-axis) + how those lines distribute. Without these a
  // wrapping flex (tag cloud / chip group / gallery) keeps its primary `itemSpacing` but loses the
  // row gap entirely → codegen guesses the vertical spacing. Omitted unless layoutWrap is WRAP and
  // the value is non-default.
  counterAxisSpacing: z.number().optional(),
  counterAxisAlignContent: z.string().optional(),
  /**
   * True when later siblings paint UNDER earlier ones (Figma's canvas order reversed) — the stacked
   * avatars / overlapping cards pattern (usually with negative itemSpacing). CSS paints later DOM
   * elements on top, so codegen must reverse z-index (or reverse the DOM + flex-direction), or the
   * stack overlaps the wrong way. Omitted when false (the default painting order).
   */
  itemReverseZIndex: z.boolean().optional(),
  /**
   * True when strokes take up layout space (Figma's default excludes them): every gap/padding
   * around a bordered child effectively grows by the stroke weight — the CSS analogue of a border
   * inside box-sizing. Omitted when false (the default).
   */
  strokesIncludedInLayout: z.boolean().optional(),
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

/** A hyperlink target on a text run or node: a URL, or an in-file NODE link (`value` is the id). */
export const SerializedHyperlinkSchema = z.object({
  type: z.string(),
  value: z.string(),
});
export type SerializedHyperlink = z.infer<typeof SerializedHyperlinkSchema>;

/**
 * A run of uniformly-styled characters within a mixed-style TEXT node (→ inline spans / links).
 * `lineHeight` / `letterSpacing` are per-run overrides (omitted at their no-op default so a plain
 * run stays lean); `hyperlink` makes the run an `<a>`; `listOptions` (ORDERED / UNORDERED) makes it
 * a list item (`<ol>` / `<ul>`); `indentation` is the list/blockquote nesting depth. The last three
 * are the structural bits the node-level `mixed` markers flag but can't locate.
 */
export const SerializedTextSegmentSchema = z.object({
  characters: z.string(),
  start: z.number(),
  end: z.number(),
  fontName: SerializedFontNameSchema,
  fontSize: z.number(),
  fills: z.array(SerializedPaintSchema),
  textDecoration: z.string(),
  textCase: z.string(),
  lineHeight: z.union([SerializedLineHeightSchema, z.literal(MIXED)]).optional(),
  letterSpacing: z.union([SerializedLetterSpacingSchema, z.literal(MIXED)]).optional(),
  hyperlink: SerializedHyperlinkSchema.optional(),
  listOptions: z.string().optional(),
  indentation: z.number().optional(),
  // Per-run design-system bindings: a run may link a shared text style (`text`) / fill style
  // (`fill`) or bind variables (a colour token on `fills`, a size token on `fontSize`). A mixed TEXT
  // node's node-level fills are `mixed`, so this is the only place a run's token binding survives —
  // without it an inline link bound to Primary/500 + Body/Bold collapses to a bare hex.
  styleIds: SerializedStyleIdsSchema.optional(),
  boundVariables: z.record(z.string(), z.array(z.string())).optional(),
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
  /**
   * Dash pattern (px on/off run lengths) → `border-style: dashed` / `dotted` and SVG
   * `stroke-dasharray`. Omitted when empty (a solid stroke), so only genuinely dashed/dotted
   * borders carry it.
   */
  dashPattern?: readonly number[];
  /** Stroke line cap (ROUND / SQUARE / arrow heads); omitted when NONE. Matters for LINE / VECTOR. */
  strokeCap?: string;
  /** Stroke line join (ROUND / BEVEL); omitted at the MITER default. */
  strokeJoin?: string;
  effects?: readonly SerializedEffect[];
  layout?: SerializedAutoLayout;
  // how this node sizes/positions itself inside an auto-layout parent
  layoutSizingHorizontal?: string;
  layoutSizingVertical?: string;
  layoutGrow?: number;
  layoutAlign?: string;
  layoutPositioning?: string;
  /**
   * Min/max size bounds (auto-layout frames and their direct children) — the designer's explicit
   * responsive constraints (→ min-w / max-w / min-h / max-h). Unset bounds are null in Figma and
   * omitted here, so only real constraints surface.
   */
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  /** Placement inside a GRID auto-layout parent (only when the parent's layoutMode is GRID). */
  gridChild?: SerializedGridChild;
  // non-auto-layout positioning
  constraints?: SerializedConstraints;
  clipsContent?: boolean;
  /**
   * A frame's own layout grids (COLUMNS / ROWS / GRID) — the explicit responsive column system a
   * designer sets up (12-col, 8px baseline). This is the ground-truth breakpoint scaffold codegen
   * otherwise has to infer; present only on frames that actually define grids. Distinct from
   * `layout` (auto-layout flex/grid of children).
   */
  layoutGrids?: readonly SerializedLayoutGrid[];
  /**
   * Scroll behaviour of a clipping frame (HORIZONTAL / VERTICAL / BOTH) → overflow; omitted when
   * NONE.
   */
  overflowDirection?: string;
  /**
   * How many of a scrolling frame's leading children stay pinned while the rest scroll — the
   * `position: sticky` half of overflowDirection (a table header, a pinned toolbar). Omitted at 0.
   */
  numberOfFixedChildren?: number;
  /**
   * The locked width:height ratio the node resizes toward (→ CSS `aspect-ratio: x / y`) — the
   * responsive contract of media boxes and hero images. Omitted when no ratio is locked.
   */
  targetAspectRatio?: { x: number; y: number };
  /**
   * Dev Mode annotations pinned to this node — the designer's notes written FOR the developer ("use
   * brand colour here", "hover only"). Ground truth that outranks any inference; omitted when the
   * node has none.
   */
  annotations?: readonly SerializedAnnotation[];
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
  /**
   * A node-level hyperlink (the whole text is a link → `<a href>`). Present only when the entire
   * node carries one uniform link; a link on only part of the text surfaces per-run in `segments`
   * instead.
   */
  hyperlink?: SerializedHyperlink;
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
    dashPattern: z.array(z.number()).optional(),
    strokeCap: z.string().optional(),
    strokeJoin: z.string().optional(),
    effects: z.array(SerializedEffectSchema).optional(),
    layout: SerializedAutoLayoutSchema.optional(),
    layoutSizingHorizontal: z.string().optional(),
    layoutSizingVertical: z.string().optional(),
    layoutGrow: z.number().optional(),
    layoutAlign: z.string().optional(),
    layoutPositioning: z.string().optional(),
    minWidth: z.number().optional(),
    maxWidth: z.number().optional(),
    minHeight: z.number().optional(),
    maxHeight: z.number().optional(),
    gridChild: SerializedGridChildSchema.optional(),
    constraints: SerializedConstraintsSchema.optional(),
    clipsContent: z.boolean().optional(),
    layoutGrids: z.array(SerializedLayoutGridSchema).optional(),
    overflowDirection: z.string().optional(),
    numberOfFixedChildren: z.number().optional(),
    targetAspectRatio: z.object({ x: z.number(), y: z.number() }).optional(),
    annotations: z.array(SerializedAnnotationSchema).optional(),
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
    hyperlink: SerializedHyperlinkSchema.optional(),
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
