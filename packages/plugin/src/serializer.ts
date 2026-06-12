import {
  MIXED,
  type SerializedAutoLayout,
  type SerializedComponentProperty,
  type SerializedEffect,
  type SerializedGridChild,
  type SerializedGridTrack,
  type SerializedLayoutGrid,
  type SerializedLetterSpacing,
  type SerializedLineHeight,
  type SerializedNode,
  type SerializedPaint,
  type SerializedStyleIds,
  type SerializedTextSegment,
  serializeNode as serializeBase,
} from '@figwright/shared';

const isGradient = (paint: Paint): paint is GradientPaint =>
  paint.type === 'GRADIENT_LINEAR' ||
  paint.type === 'GRADIENT_RADIAL' ||
  paint.type === 'GRADIENT_ANGULAR' ||
  paint.type === 'GRADIENT_DIAMOND';

export const serializePaint = (paint: Paint): SerializedPaint => {
  const visible = paint.visible ?? true;
  const opacity = paint.opacity ?? 1;
  if (paint.type === 'SOLID') {
    return {
      type: 'SOLID',
      visible,
      opacity,
      color: { r: paint.color.r, g: paint.color.g, b: paint.color.b },
    };
  }
  if (isGradient(paint)) {
    // Real Figma gradients always carry these; default defensively so we never throw or emit a
    // gradient that violates the (stops + transform) schema.
    const stops = paint.gradientStops ?? [];
    const transform = paint.gradientTransform ?? [
      [1, 0, 0],
      [0, 1, 0],
    ];
    return {
      type: paint.type,
      visible,
      opacity,
      gradientStops: stops.map(s => ({
        position: s.position,
        color: { r: s.color.r, g: s.color.g, b: s.color.b, a: s.color.a },
      })),
      gradientTransform: transform.map(row => row.slice()),
    };
  }
  // IMAGE / VIDEO paints carry a scaleMode (FILL/FIT/CROP/TILE) — the object-fit equivalent, needed
  // so exported images get the right fit instead of being stretched. PATTERN has no scaleMode.
  const scaleMode = 'scaleMode' in paint ? (paint as { scaleMode?: string }).scaleMode : undefined;
  return scaleMode === undefined
    ? { type: paint.type, visible, opacity }
    : {
        type: paint.type,
        visible,
        opacity,
        scaleMode: scaleMode as 'FILL' | 'FIT' | 'CROP' | 'TILE',
      };
};

/** GridTrackSize[] (gridRow/ColumnSizes) → `{ type, value }[]` (FLEX = fr fraction, FIXED = px). */
const serializeGridTracks = (tracks: unknown): SerializedGridTrack[] | undefined => {
  if (!Array.isArray(tracks)) return undefined;
  return tracks
    .filter(
      (t): t is { type: unknown; value: unknown } =>
        typeof t === 'object' && t !== null && 'type' in t && 'value' in t,
    )
    .map(t => ({ type: String(t.type), value: Number(t.value) }));
};

const serializeAutoLayout = (node: SceneNode): SerializedAutoLayout => {
  const n = node as SceneNode & {
    layoutMode: 'HORIZONTAL' | 'VERTICAL' | 'GRID';
    paddingTop: number;
    paddingRight: number;
    paddingBottom: number;
    paddingLeft: number;
    itemSpacing: number;
    primaryAxisAlignItems: string;
    counterAxisAlignItems: string;
    layoutWrap?: string;
    gridRowCount?: number;
    gridColumnCount?: number;
    gridRowGap?: number;
    gridColumnGap?: number;
    gridRowSizes?: unknown;
    gridColumnSizes?: unknown;
  };
  const padding = {
    paddingTop: n.paddingTop,
    paddingRight: n.paddingRight,
    paddingBottom: n.paddingBottom,
    paddingLeft: n.paddingLeft,
  };
  // GRID auto-layout: no itemSpacing / primary-counter align — it carries row/col counts + gaps +
  // track sizes instead (→ CSS Grid). padding is common.
  if (n.layoutMode === 'GRID') {
    const out: SerializedAutoLayout = { mode: 'GRID', ...padding };
    if (typeof n.gridRowCount === 'number') out.gridRowCount = n.gridRowCount;
    if (typeof n.gridColumnCount === 'number') out.gridColumnCount = n.gridColumnCount;
    if (typeof n.gridRowGap === 'number') out.gridRowGap = n.gridRowGap;
    if (typeof n.gridColumnGap === 'number') out.gridColumnGap = n.gridColumnGap;
    const rowSizes = serializeGridTracks(n.gridRowSizes);
    if (rowSizes !== undefined) out.gridRowSizes = rowSizes;
    const colSizes = serializeGridTracks(n.gridColumnSizes);
    if (colSizes !== undefined) out.gridColumnSizes = colSizes;
    return out;
  }
  const out: SerializedAutoLayout = {
    mode: n.layoutMode,
    ...padding,
    itemSpacing: n.itemSpacing,
    primaryAxisAlignItems: n.primaryAxisAlignItems,
    counterAxisAlignItems: n.counterAxisAlignItems,
  };
  if (typeof n.layoutWrap === 'string') out.layoutWrap = n.layoutWrap;
  return out;
};

/** A node's placement inside a GRID parent → `gridChild` (anchor / span / per-cell align). */
const serializeGridChild = (node: SceneNode): SerializedGridChild | undefined => {
  const n = node as SceneNode & {
    gridRowAnchorIndex?: number;
    gridColumnAnchorIndex?: number;
    gridRowSpan?: number;
    gridColumnSpan?: number;
    gridChildHorizontalAlign?: string;
    gridChildVerticalAlign?: string;
  };
  const out: SerializedGridChild = {};
  // anchor -1 = auto-flowed (no explicit cell) → omit; >= 0 = pinned to a specific row/column.
  if (typeof n.gridRowAnchorIndex === 'number' && n.gridRowAnchorIndex >= 0) {
    out.rowAnchorIndex = n.gridRowAnchorIndex;
  }
  if (typeof n.gridColumnAnchorIndex === 'number' && n.gridColumnAnchorIndex >= 0) {
    out.columnAnchorIndex = n.gridColumnAnchorIndex;
  }
  if (typeof n.gridRowSpan === 'number' && n.gridRowSpan !== 1) out.rowSpan = n.gridRowSpan;
  if (typeof n.gridColumnSpan === 'number' && n.gridColumnSpan !== 1) {
    out.columnSpan = n.gridColumnSpan;
  }
  if (typeof n.gridChildHorizontalAlign === 'string' && n.gridChildHorizontalAlign !== 'AUTO') {
    out.horizontalAlign = n.gridChildHorizontalAlign;
  }
  if (typeof n.gridChildVerticalAlign === 'string' && n.gridChildVerticalAlign !== 'AUTO') {
    out.verticalAlign = n.gridChildVerticalAlign;
  }
  // A plain auto-flowed cell (anchor -1, span 1, align AUTO) carries no placement → omit entirely.
  return Object.keys(out).length > 0 ? out : undefined;
};

const serializeLineHeight = (lh: unknown): SerializedLineHeight | typeof MIXED => {
  if (typeof lh !== 'object' || lh === null) return MIXED;
  const o = lh as { unit?: unknown; value?: unknown };
  if (o.unit === 'AUTO') return { unit: 'AUTO' };
  if ((o.unit === 'PIXELS' || o.unit === 'PERCENT') && typeof o.value === 'number') {
    return { value: o.value, unit: o.unit };
  }
  return MIXED;
};

const serializeLetterSpacing = (ls: unknown): SerializedLetterSpacing | typeof MIXED => {
  if (typeof ls !== 'object' || ls === null) return MIXED;
  const o = ls as { unit?: unknown; value?: unknown };
  if ((o.unit === 'PIXELS' || o.unit === 'PERCENT') && typeof o.value === 'number') {
    return { value: o.value, unit: o.unit };
  }
  return MIXED;
};

const isAutoLayoutParent = (node: SceneNode): boolean => {
  const parent = node.parent;
  return (
    parent !== null &&
    'layoutMode' in parent &&
    (parent as { layoutMode: unknown }).layoutMode !== 'NONE'
  );
};

/** Variable alias(es) → flat list of variable ids (names are resolved later, async). */
const aliasIds = (val: unknown): string[] => {
  const aliases = Array.isArray(val) ? val : [val];
  return aliases
    .filter((a): a is { id: string } => typeof a === 'object' && a !== null && 'id' in a)
    .map(a => a.id);
};

const collectStyleLinks = (node: SceneNode, out: SerializedNode): void => {
  const styleIds: SerializedStyleIds = {};
  const pick = (
    key: 'fillStyleId' | 'strokeStyleId' | 'effectStyleId' | 'textStyleId',
  ): string | undefined => {
    const value = (node as unknown as Record<string, unknown>)[key];
    return typeof value === 'string' && value !== '' ? value : undefined;
  };
  const fill = pick('fillStyleId');
  if (fill !== undefined) styleIds.fill = fill;
  const stroke = pick('strokeStyleId');
  if (stroke !== undefined) styleIds.stroke = stroke;
  const effect = pick('effectStyleId');
  if (effect !== undefined) styleIds.effect = effect;
  const text = pick('textStyleId');
  if (text !== undefined) styleIds.text = text;
  if (Object.keys(styleIds).length > 0) out.styleIds = styleIds;

  const bound = (node as { boundVariables?: unknown }).boundVariables;
  if (typeof bound === 'object' && bound !== null) {
    const result: Record<string, string[]> = {};
    for (const [field, val] of Object.entries(bound)) {
      const ids = aliasIds(val);
      if (ids.length > 0) result[field] = ids;
    }
    if (Object.keys(result).length > 0) out.boundVariables = result;
  }
};

const SEGMENT_FIELDS = ['fontName', 'fontSize', 'fills', 'textDecoration', 'textCase'] as const;

/** Break a mixed-style TEXT node into runs of uniform styling (so inline bold/links/colors survive). */
const serializeTextSegments = (text: TextNode): SerializedTextSegment[] => {
  const segments = text.getStyledTextSegments([...SEGMENT_FIELDS]);
  return segments.map(s => ({
    characters: s.characters,
    start: s.start,
    end: s.end,
    fontName: { family: s.fontName.family, style: s.fontName.style },
    fontSize: s.fontSize,
    fills: Array.isArray(s.fills) ? s.fills.map(p => serializePaint(p as Paint)) : [],
    textDecoration: s.textDecoration,
    textCase: s.textCase,
  }));
};

const collectComponentProperties = (node: SceneNode, out: SerializedNode): void => {
  const raw = (node as { componentProperties?: unknown }).componentProperties;
  if (typeof raw !== 'object' || raw === null) return;
  const props: Record<string, SerializedComponentProperty> = {};
  for (const [name, def] of Object.entries(raw)) {
    const d = def as { type?: unknown; value?: unknown };
    if (
      typeof d.type === 'string' &&
      (typeof d.value === 'string' || typeof d.value === 'boolean')
    ) {
      props[name] = { type: d.type, value: d.value };
    }
  }
  if (Object.keys(props).length > 0) out.componentProperties = props;
};

const enrichWithMixins = (node: SceneNode, base: SerializedNode): SerializedNode => {
  const out: SerializedNode = { ...base };

  if ('rotation' in node && typeof node.rotation === 'number') {
    out.rotation = node.rotation;
  }
  if ('opacity' in node && typeof node.opacity === 'number') {
    out.opacity = node.opacity;
  }
  if ('cornerRadius' in node) {
    const cr = (node as { cornerRadius: unknown }).cornerRadius;
    if (typeof cr === 'number') {
      out.cornerRadius = cr;
    } else {
      // cornerRadius is figma.mixed → the corners differ. Surface each per-corner radius so codegen
      // can emit individual radii (rounded-t / rounded-tl / …) instead of a uniform radius — cards
      // rounded on one edge, tabs and chat bubbles are all per-corner, and collapsing to a single
      // "mixed" loses which corners actually round. (Same fidelity fix as per-side strokeWeights.)
      out.cornerRadius = MIXED;
      const n = node as {
        topLeftRadius?: unknown;
        topRightRadius?: unknown;
        bottomRightRadius?: unknown;
        bottomLeftRadius?: unknown;
      };
      const corners = {
        topLeft: n.topLeftRadius,
        topRight: n.topRightRadius,
        bottomRight: n.bottomRightRadius,
        bottomLeft: n.bottomLeftRadius,
      };
      if (Object.values(corners).every(v => typeof v === 'number')) {
        out.cornerRadii = corners as {
          topLeft: number;
          topRight: number;
          bottomRight: number;
          bottomLeft: number;
        };
      }
    }
  }
  // Blend mode (overlays / multiply / screen). Omit the no-op PASS_THROUGH (the common case) so the
  // field only appears when it actually changes compositing.
  if ('blendMode' in node) {
    const bm = (node as { blendMode: unknown }).blendMode;
    if (typeof bm === 'string' && bm !== 'PASS_THROUGH') out.blendMode = bm;
  }
  // Mask layers clip their later siblings; codegen must know not to render them as ordinary images.
  if ('isMask' in node && (node as { isMask: unknown }).isMask === true) {
    out.isMask = true;
    const mt = (node as { maskType?: unknown }).maskType;
    if (typeof mt === 'string') out.maskType = mt;
  }
  if ('fills' in node) {
    const fills = (node as { fills: unknown }).fills;
    out.fills = Array.isArray(fills) ? fills.map(p => serializePaint(p as Paint)) : MIXED;
  }
  if ('strokes' in node) {
    const strokes = (node as { strokes: unknown }).strokes;
    if (Array.isArray(strokes) && strokes.length > 0) {
      out.strokes = strokes.map(p => serializePaint(p as Paint));
      const weight = (node as { strokeWeight?: unknown }).strokeWeight;
      if (typeof weight === 'number') {
        out.strokeWeight = weight;
      } else {
        // strokeWeight is figma.mixed → the sides differ. Surface each per-side weight so codegen
        // can emit individual borders (border-t / border-b / …) instead of a uniform border —
        // table row dividers, underline inputs and top-accent rules are all per-side, and
        // collapsing to a single "mixed" loses which edges actually have a stroke.
        out.strokeWeight = MIXED;
        // Per-property cast (matching this file's idiom) rather than `as Record<string, unknown>`:
        // newer plugin-typings include nodes (e.g. SlotNode) without an index signature, so the
        // record cast no longer type-checks.
        const n = node as {
          strokeTopWeight?: unknown;
          strokeRightWeight?: unknown;
          strokeBottomWeight?: unknown;
          strokeLeftWeight?: unknown;
        };
        const sides = {
          top: n.strokeTopWeight,
          right: n.strokeRightWeight,
          bottom: n.strokeBottomWeight,
          left: n.strokeLeftWeight,
        };
        if (Object.values(sides).every(v => typeof v === 'number')) {
          out.strokeWeights = sides as { top: number; right: number; bottom: number; left: number };
        }
      }
      const align = (node as { strokeAlign?: unknown }).strokeAlign;
      if (typeof align === 'string') out.strokeAlign = align;
    }
  }
  if ('effects' in node) {
    const effects = (node as { effects: unknown }).effects;
    if (Array.isArray(effects) && effects.length > 0) {
      out.effects = effects.map(e => serializeEffect(e as Effect));
    }
  }
  if ('layoutMode' in node && (node as { layoutMode: unknown }).layoutMode !== 'NONE') {
    out.layout = serializeAutoLayout(node);
  }

  // How the node sizes/positions in its parent (only valid for auto-layout children); otherwise
  // fall back to absolute-positioning constraints.
  if (isAutoLayoutParent(node)) {
    const sizingH = (node as { layoutSizingHorizontal?: unknown }).layoutSizingHorizontal;
    if (typeof sizingH === 'string') out.layoutSizingHorizontal = sizingH;
    const sizingV = (node as { layoutSizingVertical?: unknown }).layoutSizingVertical;
    if (typeof sizingV === 'string') out.layoutSizingVertical = sizingV;
    const grow = (node as { layoutGrow?: unknown }).layoutGrow;
    if (typeof grow === 'number' && grow !== 0) out.layoutGrow = grow;
    const align = (node as { layoutAlign?: unknown }).layoutAlign;
    if (typeof align === 'string' && align !== 'INHERIT') out.layoutAlign = align;
    if ((node as { layoutPositioning?: unknown }).layoutPositioning === 'ABSOLUTE') {
      out.layoutPositioning = 'ABSOLUTE';
    }
    // Inside a GRID parent the child also carries grid placement (anchor / span / per-cell align).
    const parent = node.parent;
    if (
      parent !== null &&
      'layoutMode' in parent &&
      (parent as { layoutMode: unknown }).layoutMode === 'GRID'
    ) {
      const gc = serializeGridChild(node);
      if (gc !== undefined) out.gridChild = gc;
    }
  } else if ('constraints' in node) {
    const c = (node as { constraints?: unknown }).constraints;
    if (typeof c === 'object' && c !== null && 'horizontal' in c && 'vertical' in c) {
      out.constraints = {
        horizontal: String((c as { horizontal: unknown }).horizontal),
        vertical: String((c as { vertical: unknown }).vertical),
      };
    }
  }

  if (
    'clipsContent' in node &&
    typeof (node as { clipsContent: unknown }).clipsContent === 'boolean'
  ) {
    out.clipsContent = (node as { clipsContent: boolean }).clipsContent;
  }

  collectStyleLinks(node, out);
  collectComponentProperties(node, out);

  if (node.type === 'TEXT') {
    const text = node as TextNode;
    out.characters = text.characters;
    out.fontSize = typeof text.fontSize === 'number' ? text.fontSize : MIXED;
    out.fontName = isFontName(text.fontName) ? { ...text.fontName } : MIXED;
    out.textAlignHorizontal = text.textAlignHorizontal;
    out.textAlignVertical = text.textAlignVertical;
    out.lineHeight = serializeLineHeight(text.lineHeight);
    out.letterSpacing = serializeLetterSpacing(text.letterSpacing);
    out.textCase = typeof text.textCase === 'string' ? text.textCase : MIXED;
    out.textDecoration = typeof text.textDecoration === 'string' ? text.textDecoration : MIXED;
    // Node-level layout/overflow props (not per-run) — needed for codegen (ellipsis / line-clamp).
    out.textAutoResize = text.textAutoResize;
    out.textTruncation = text.textTruncation;
    out.maxLines = text.maxLines;
    if (typeof text.paragraphSpacing === 'number') out.paragraphSpacing = text.paragraphSpacing;
    if (typeof text.paragraphIndent === 'number') out.paragraphIndent = text.paragraphIndent;
    // Only expand per-run styling when the node is actually mixed (uniform text needs no segments).
    const isMixed =
      out.fontSize === MIXED ||
      out.fontName === MIXED ||
      out.fills === MIXED ||
      out.textCase === MIXED ||
      out.textDecoration === MIXED;
    if (isMixed && typeof text.getStyledTextSegments === 'function') {
      out.segments = serializeTextSegments(text);
    }
  }

  return out;
};

const isFontName = (value: unknown): value is FontName =>
  typeof value === 'object' && value !== null && 'family' in value && 'style' in value;

const toBase = (node: SceneNode): SerializedNode =>
  serializeBase({
    id: node.id,
    name: node.name,
    type: node.type,
    visible: node.visible,
    locked: node.locked,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    parent: node.parent === null ? null : { id: node.parent.id },
  });

/**
 * Synchronous serialization (no mainComponent). Used where async resolution isn't wanted, e.g. the
 * depth/detail-gated get_design_context view.
 */
export const serializeFlatSync = (node: SceneNode): SerializedNode =>
  enrichWithMixins(node, toBase(node));

/** Resolve the main component of an INSTANCE (async; tolerates unavailable/missing components). */
const resolveMainComponent = async (
  node: SceneNode,
): Promise<void | SerializedNode['mainComponent']> => {
  if (node.type !== 'INSTANCE') return undefined;
  try {
    const main = await (node as InstanceNode).getMainComponentAsync();
    if (main === null) return undefined;
    const out: NonNullable<SerializedNode['mainComponent']> = {
      id: main.id,
      name: main.name,
      key: main.key,
    };
    // Carry the owning COMPONENT_SET (already loaded as the main component's parent) so consumers can
    // name a variant instance by its set without a doc-wide scan.
    const parent = main.parent;
    if (parent != null && parent.type === 'COMPONENT_SET') {
      out.componentSetId = parent.id;
      out.componentSetName = parent.name;
    }
    return out;
  } catch {
    return undefined;
  }
};

export const serializeFlat = async (node: SceneNode): Promise<SerializedNode> => {
  const out = serializeFlatSync(node);
  const mainComponent = await resolveMainComponent(node);
  if (mainComponent !== undefined) out.mainComponent = mainComponent;
  return out;
};

export const serializeTree = async (node: SceneNode): Promise<SerializedNode> => {
  const out = await serializeFlat(node);
  if ('children' in node && Array.isArray(node.children)) {
    const children = await Promise.all((node.children as readonly SceneNode[]).map(serializeTree));
    return { ...out, children };
  }
  return out;
};

export const serializeEffect = (effect: Effect): SerializedEffect => {
  if (effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW') {
    return {
      type: effect.type,
      visible: effect.visible,
      radius: effect.radius,
      color: { r: effect.color.r, g: effect.color.g, b: effect.color.b, a: effect.color.a },
      offset: { x: effect.offset.x, y: effect.offset.y },
      spread: effect.spread ?? 0,
    };
  }
  // Blurs / textures carry radius; noise / glass carry only type + visible.
  const out: SerializedEffect = { type: effect.type, visible: effect.visible };
  if ('radius' in effect && typeof effect.radius === 'number') out.radius = effect.radius;
  return out;
};

export const serializeLayoutGrid = (grid: LayoutGrid): SerializedLayoutGrid => {
  if (grid.pattern === 'GRID') {
    return { pattern: 'GRID', visible: grid.visible ?? true, sectionSize: grid.sectionSize };
  }
  const out: SerializedLayoutGrid = {
    pattern: grid.pattern,
    visible: grid.visible ?? true,
    count: grid.count,
    gutterSize: grid.gutterSize,
    alignment: grid.alignment,
  };
  if (typeof grid.sectionSize === 'number') out.sectionSize = grid.sectionSize;
  return out;
};
