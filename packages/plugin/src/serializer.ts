import {
  MIXED,
  type SerializedAnnotation,
  type SerializedAutoLayout,
  type SerializedBindings,
  type SerializedColorStop,
  type SerializedComponentProperty,
  type SerializedEffect,
  type SerializedFontName,
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

import { cssAngleFromGradientTransform } from './gradient-angle.js';

const isGradient = (paint: Paint): paint is GradientPaint =>
  paint.type === 'GRADIENT_LINEAR' ||
  paint.type === 'GRADIENT_RADIAL' ||
  paint.type === 'GRADIENT_ANGULAR' ||
  paint.type === 'GRADIENT_DIAMOND';

/**
 * One Dev Mode annotation — shared by the get_annotations tool and the per-node embedding in
 * serializeFlatSync, so both surfaces return the same shape.
 */
export const serializeAnnotation = (a: Annotation): SerializedAnnotation => {
  const out: SerializedAnnotation = {};
  if (a.label !== undefined) out.label = a.label;
  if (a.labelMarkdown !== undefined) out.labelMarkdown = a.labelMarkdown;
  if (a.categoryId !== undefined) out.categoryId = a.categoryId;
  if (a.properties !== undefined) out.properties = a.properties.map(p => p.type);
  return out;
};

/** Non-zero image adjustments (exposure / contrast / …) — the original bytes don't carry them. */
const hasImageAdjustments = (filters: unknown): boolean =>
  typeof filters === 'object' &&
  filters !== null &&
  Object.values(filters).some(v => typeof v === 'number' && v !== 0);

/**
 * A paint / effect / layout-grid / gradient-stop `boundVariables` record → `field` → variable id.
 * Figma keeps these bindings on the object itself (not in the owning node's `boundVariables`), and
 * each field binds exactly one variable — so this is the single-alias counterpart to
 * `collectBoundVariables` below. Field names pass through as Figma reports them, so a newly
 * bindable field is carried rather than silently dropped. Returns undefined when nothing is bound,
 * keeping unbound paints/effects byte-identical to before.
 */
export const collectBindings = (raw: unknown): SerializedBindings | undefined => {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const out: SerializedBindings = {};
  for (const [field, alias] of Object.entries(raw)) {
    if (typeof alias === 'object' && alias !== null && 'id' in alias) {
      const id = (alias as { id: unknown }).id;
      if (typeof id === 'string') out[field] = id;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
};

/**
 * The owning node's rendered size, needed to turn a gradient's axis matrix into a CSS angle. `null`
 * means the paint has no owning node (a paint style), where the angle genuinely does not exist
 * rather than merely being unknown.
 */
export interface PaintOwnerSize {
  width: number;
  height: number;
}

/**
 * `ownerSize` is required rather than optional on purpose: a caller that forgot to pass it would
 * silently emit gradients with no angle, and nothing would fail. Making the "no owner" case an
 * explicit `null` turns that omission into a type error instead.
 */
export const serializePaint = (paint: Paint, ownerSize: PaintOwnerSize | null): SerializedPaint => {
  const visible = paint.visible ?? true;
  const opacity = paint.opacity ?? 1;
  if (paint.type === 'SOLID') {
    // A bound colour lives on the paint, not on the owning node — carry it, or a variable-driven
    // fill is indistinguishable from a hard-coded one downstream (issue #164).
    const bound = collectBindings(paint.boundVariables);
    return {
      type: 'SOLID',
      visible,
      opacity,
      color: { r: paint.color.r, g: paint.color.g, b: paint.color.b },
      ...(bound === undefined ? {} : { boundVariables: bound }),
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
    // Only GRADIENT_LINEAR maps onto a CSS angle; the other three are a centre plus radii, so
    // reporting an "angle" for them would be a confident lie rather than a missing field.
    const cssAngle =
      paint.type === 'GRADIENT_LINEAR' && ownerSize !== null
        ? cssAngleFromGradientTransform(transform, ownerSize.width, ownerSize.height)
        : undefined;
    return {
      type: paint.type,
      visible,
      opacity,
      ...(cssAngle === undefined ? {} : { cssAngle }),
      gradientStops: stops.map(s => {
        const stop: SerializedColorStop = {
          position: s.position,
          color: { r: s.color.r, g: s.color.g, b: s.color.b, a: s.color.a },
        };
        // Each stop binds its own colour, so the binding has to ride on the stop, not the paint.
        const bound = collectBindings(s.boundVariables);
        if (bound !== undefined) stop.boundVariables = bound;
        return stop;
      }),
      gradientTransform: transform.map(row => row.slice()),
    };
  }
  if (paint.type === 'PATTERN') {
    // A source node tiled across the fill. Carry the geometry to reconstruct the tiling; the tile
    // artwork itself is exported separately (like a raster) via get_screenshot on sourceNodeId.
    // Omit the no-op defaults (spacing 0,0 / alignment START) to keep the payload lean.
    const spacing =
      paint.spacing.x !== 0 || paint.spacing.y !== 0
        ? { spacing: { x: paint.spacing.x, y: paint.spacing.y } }
        : undefined;
    const alignment =
      paint.horizontalAlignment !== 'START'
        ? { horizontalAlignment: paint.horizontalAlignment }
        : undefined;
    return {
      type: 'PATTERN',
      visible,
      opacity,
      sourceNodeId: paint.sourceNodeId,
      tileType: paint.tileType,
      scalingFactor: paint.scalingFactor,
      ...spacing,
      ...alignment,
    };
  }
  // IMAGE / VIDEO paints carry a scaleMode (FILL/FIT/CROP/TILE) — the object-fit equivalent, needed
  // so exported images get the right fit instead of being stretched. SHADER has none. filtersApplied
  // flags in-fill colour grading, which the original bytes (save_image_fills) do NOT include — the
  // signal to export the composited render instead.
  const scaleMode = 'scaleMode' in paint ? (paint as { scaleMode?: string }).scaleMode : undefined;
  const filtered =
    'filters' in paint && hasImageAdjustments((paint as { filters?: unknown }).filters);
  return {
    type: paint.type,
    visible,
    opacity,
    ...(scaleMode === undefined
      ? {}
      : { scaleMode: scaleMode as 'FILL' | 'FIT' | 'CROP' | 'TILE' }),
    ...(filtered ? { filtersApplied: true } : {}),
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
    counterAxisSpacing?: number | null;
    counterAxisAlignContent?: string;
    itemReverseZIndex?: boolean;
    strokesIncludedInLayout?: boolean;
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
  // WRAP cross-axis: the row gap (counterAxisSpacing, null when content-distributed) and the line
  // distribution (counterAxisAlignContent). Only meaningful when wrapping; emit non-default values so
  // a non-wrapping flex stays clean. Figma sets counterAxisSpacing to null under SPACE_BETWEEN.
  if (n.layoutWrap === 'WRAP') {
    if (typeof n.counterAxisSpacing === 'number' && n.counterAxisSpacing !== 0) {
      out.counterAxisSpacing = n.counterAxisSpacing;
    }
    if (typeof n.counterAxisAlignContent === 'string' && n.counterAxisAlignContent !== 'AUTO') {
      out.counterAxisAlignContent = n.counterAxisAlignContent;
    }
  }
  // Non-default paint order / stroke-in-layout: later children normally paint on top (CSS agrees),
  // and strokes normally take no layout space — only the reversed/inclusive cases carry signal.
  if (n.itemReverseZIndex === true) out.itemReverseZIndex = true;
  if (n.strokesIncludedInLayout === true) out.strokesIncludedInLayout = true;
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

/**
 * Collapse a Figma `boundVariables` record (per field, an alias or alias[]) to flat id lists per
 * field, dropping fields with none. Shared by node-level and per-run (mixed TEXT segment) bindings.
 * Returns undefined when nothing is bound, so the caller only sets the field when it's meaningful.
 */
const collectBoundVariables = (raw: unknown): Record<string, string[]> | undefined => {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const result: Record<string, string[]> = {};
  for (const [field, val] of Object.entries(raw)) {
    const ids = aliasIds(val);
    if (ids.length > 0) result[field] = ids;
  }
  return Object.keys(result).length > 0 ? result : undefined;
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

  const bound = collectBoundVariables((node as { boundVariables?: unknown }).boundVariables);
  if (bound !== undefined) out.boundVariables = bound;
};

// Per-run fields we break a mixed TEXT node on. Beyond the 5 style basics we ask for the structural
// runs — hyperlink (→ <a>), listOptions (→ <ol>/<ul>), indentation (list nesting) — plus per-run
// lineHeight/letterSpacing, so inline links / list items / leading changes survive instead of
// collapsing to a single `mixed` marker.
const SEGMENT_FIELDS = [
  'fontName',
  'fontSize',
  'fills',
  'textDecoration',
  'textCase',
  'lineHeight',
  'letterSpacing',
  'hyperlink',
  'listOptions',
  'indentation',
  // Paragraph-level, but requested per run for the same reason as listOptions/indentation: a node
  // whose paragraphs disagree reports `mixed` at node level, and only the runs carry the real values.
  'textWrapStyle',
  // Per-run design-system bindings — the token grounding that a mixed node's node-level `mixed` fills
  // would otherwise lose (an inline link bound to Primary/500 + Body/Bold).
  'textStyleId',
  'fillStyleId',
  'boundVariables',
] as const;

/** Break a mixed-style TEXT node into runs of uniform styling (so inline bold/links/colors survive). */
const serializeTextSegments = (text: TextNode): SerializedTextSegment[] => {
  const segments = text.getStyledTextSegments([...SEGMENT_FIELDS]);
  // A gradient on a text run is positioned across the whole TEXT node's box, not the run's, so the
  // node's own size is what turns its axis matrix into a CSS angle — same as for a node fill.
  const ownerSize = { width: text.width, height: text.height };
  return segments.map(s => {
    const out: SerializedTextSegment = {
      characters: s.characters,
      start: s.start,
      end: s.end,
      fontName: serializeFontName(s.fontName),
      fontSize: s.fontSize,
      fills: Array.isArray(s.fills) ? s.fills.map(p => serializePaint(p as Paint, ownerSize)) : [],
      textDecoration: s.textDecoration,
      textCase: s.textCase,
    };
    // Per-run leading / tracking, only when they carry a concrete non-default value (AUTO leading /
    // 0 tracking are the no-ops). A segment is a uniform run, so these are never `mixed` on a real
    // node — skip the MIXED fallback so a run stays lean rather than emitting a meaningless marker.
    const lh = serializeLineHeight(s.lineHeight);
    if (lh !== MIXED && lh.unit !== 'AUTO') out.lineHeight = lh;
    const ls = serializeLetterSpacing(s.letterSpacing);
    if (ls !== MIXED && ls.value !== 0) out.letterSpacing = ls;
    // Structural runs: an inline link, a list item (ORDERED/UNORDERED) at some indentation depth.
    if (s.hyperlink != null) out.hyperlink = { type: s.hyperlink.type, value: s.hyperlink.value };
    if (s.listOptions != null && s.listOptions.type !== 'NONE')
      out.listOptions = s.listOptions.type;
    if (typeof s.indentation === 'number' && s.indentation > 0) out.indentation = s.indentation;
    if (typeof s.textWrapStyle === 'string' && s.textWrapStyle !== 'AUTO') {
      out.textWrapStyle = s.textWrapStyle;
    }
    // Per-run design-system bindings (mirrors collectStyleLinks for a node): a run's shared fill/text
    // style ids + variable bindings. Ids are carried raw here and resolved to token names downstream
    // (get_design_context's resolveTokens), exactly like a node's own styleIds / boundVariables.
    const styleIds: SerializedStyleIds = {};
    if (typeof s.fillStyleId === 'string' && s.fillStyleId !== '') styleIds.fill = s.fillStyleId;
    if (typeof s.textStyleId === 'string' && s.textStyleId !== '') styleIds.text = s.textStyleId;
    if (Object.keys(styleIds).length > 0) out.styleIds = styleIds;
    const bound = collectBoundVariables(s.boundVariables);
    if (bound !== undefined) out.boundVariables = bound;
    return out;
  });
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
  // Ellipse arc data (pie slices, gauges, rings / donuts). Only an EllipseNode exposes arcData; emit
  // it only when the ellipse isn't a plain full disc — a partial sweep or a non-zero innerRadius — so
  // a solid circle stays clean. Otherwise codegen would render a progress ring or pie as a flat
  // circle. startingAngle / endingAngle are radians; innerRadius is 0–1 of the outer radius.
  if ('arcData' in node) {
    const arc = (
      node as { arcData: { startingAngle: number; endingAngle: number; innerRadius: number } }
    ).arcData;
    const sweep = arc.endingAngle - arc.startingAngle;
    const isFullDisc = arc.innerRadius === 0 && sweep >= Math.PI * 2 - 1e-4;
    if (!isFullDisc) {
      out.arcData = {
        startingAngle: arc.startingAngle,
        endingAngle: arc.endingAngle,
        innerRadius: arc.innerRadius,
      };
    }
  }
  // A linear gradient's CSS angle depends on the node's proportions, not just its axis matrix, so
  // the paints of this node get its size threaded in. Paint styles serialize with no size and
  // correctly report no angle.
  const ownerSize =
    typeof out.width === 'number' && typeof out.height === 'number'
      ? { width: out.width, height: out.height }
      : null;
  if ('fills' in node) {
    const fills = (node as { fills: unknown }).fills;
    out.fills = Array.isArray(fills)
      ? fills.map(p => serializePaint(p as Paint, ownerSize))
      : MIXED;
  }
  if ('strokes' in node) {
    const strokes = (node as { strokes: unknown }).strokes;
    if (Array.isArray(strokes) && strokes.length > 0) {
      out.strokes = strokes.map(p => serializePaint(p as Paint, ownerSize));
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
      // Dash pattern (px on/off runs) → dashed/dotted borders and SVG stroke-dasharray. Empty = solid
      // (the common case) → omit. strokeCap (line ends / arrowheads) omitted at NONE; strokeJoin
      // omitted at the MITER default. These matter for dividers, LINE and VECTOR strokes.
      const dash = (node as { dashPattern?: unknown }).dashPattern;
      if (Array.isArray(dash) && dash.length > 0 && dash.every(d => typeof d === 'number')) {
        out.dashPattern = dash as number[];
      }
      const cap = (node as { strokeCap?: unknown }).strokeCap;
      if (typeof cap === 'string' && cap !== 'NONE') out.strokeCap = cap;
      const join = (node as { strokeJoin?: unknown }).strokeJoin;
      if (typeof join === 'string' && join !== 'MITER') out.strokeJoin = join;
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

  // Min/max size bounds — the designer's explicit responsive constraints (→ min-w / max-w /
  // min-h / max-h). They apply to auto-layout frames AND their direct children, so this sits
  // outside the isAutoLayoutParent branch above (a top-level auto-layout frame carries its own
  // maxWidth). Unset bounds read null and are omitted, so plain nodes stay lean.
  if ('minWidth' in node) {
    const n = node as {
      minWidth?: number | null;
      maxWidth?: number | null;
      minHeight?: number | null;
      maxHeight?: number | null;
    };
    if (typeof n.minWidth === 'number') out.minWidth = n.minWidth;
    if (typeof n.maxWidth === 'number') out.maxWidth = n.maxWidth;
    if (typeof n.minHeight === 'number') out.minHeight = n.minHeight;
    if (typeof n.maxHeight === 'number') out.maxHeight = n.maxHeight;
  }

  if (
    'clipsContent' in node &&
    typeof (node as { clipsContent: unknown }).clipsContent === 'boolean'
  ) {
    out.clipsContent = (node as { clipsContent: boolean }).clipsContent;
  }
  // A frame's own layout grids — the explicit responsive column system (12-col, baseline) a designer
  // sets up. This is ground-truth breakpoint structure codegen otherwise infers; emit only when the
  // frame actually defines grids. overflowDirection is the scroll axis of a clipping frame (→
  // overflow-x/y), omitted at NONE.
  if ('layoutGrids' in node) {
    const grids = (node as { layoutGrids?: unknown }).layoutGrids;
    if (Array.isArray(grids) && grids.length > 0) {
      out.layoutGrids = grids.map(g => serializeLayoutGrid(g as LayoutGrid));
    }
  }
  if ('overflowDirection' in node) {
    const dir = (node as { overflowDirection?: unknown }).overflowDirection;
    if (typeof dir === 'string' && dir !== 'NONE') out.overflowDirection = dir;
  }
  // The sticky half of scrolling: how many leading children stay pinned (→ position: sticky).
  if ('numberOfFixedChildren' in node) {
    const fixed = (node as { numberOfFixedChildren?: unknown }).numberOfFixedChildren;
    if (typeof fixed === 'number' && fixed > 0) out.numberOfFixedChildren = fixed;
  }
  // A locked resize ratio (→ CSS aspect-ratio) — the responsive contract of media boxes.
  if ('targetAspectRatio' in node) {
    const ratio = (node as { targetAspectRatio?: { x?: unknown; y?: unknown } | null })
      .targetAspectRatio;
    // Both axes must be positive: a zero/negative side would emit an invalid `aspect-ratio: x / y`
    // (aspect-[0/9] or a div-by-zero). A locked ratio is always positive, so this only guards the
    // degenerate case — symmetric on x and y rather than checking one side.
    if (
      ratio != null &&
      typeof ratio.x === 'number' &&
      typeof ratio.y === 'number' &&
      ratio.x > 0 &&
      ratio.y > 0
    ) {
      out.targetAspectRatio = { x: ratio.x, y: ratio.y };
    }
  }
  // Dev Mode annotations — the designer's notes written FOR the developer; ground truth.
  if ('annotations' in node) {
    const anns = (node as { annotations?: unknown }).annotations;
    if (Array.isArray(anns) && anns.length > 0) {
      out.annotations = (anns as Annotation[]).map(serializeAnnotation);
    }
  }

  collectStyleLinks(node, out);
  collectComponentProperties(node, out);

  if (node.type === 'TEXT') {
    const text = node as TextNode;
    out.characters = text.characters;
    out.fontSize = typeof text.fontSize === 'number' ? text.fontSize : MIXED;
    out.fontName = isFontName(text.fontName) ? serializeFontName(text.fontName) : MIXED;
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
    // Wrap balancing is per paragraph, so it is `mixed` (a symbol) as soon as two paragraphs
    // disagree. Emit the uniform case node-level; the mixed case drives needsSegments below so the
    // per-paragraph values survive in `segments` rather than vanishing.
    const wrapMixed = typeof text.textWrapStyle === 'symbol';
    if (typeof text.textWrapStyle === 'string') out.textWrapStyle = text.textWrapStyle;
    // Node-level hyperlink: a uniform link over the whole node → <a href>. `hyperlink` is an object
    // when uniform, figma.mixed (a symbol) when only part of the text links (surfaced per-run in
    // segments), null when none. Emit only the uniform-object case; mixed drives needsSegments below.
    // Detect mixed via `typeof === 'symbol'` (the file's type-guard idiom, no figma.mixed ref).
    const link = text.hyperlink;
    const linkMixed = typeof link === 'symbol';
    if (link !== null && !linkMixed && typeof link === 'object') {
      out.hyperlink = { type: link.type, value: link.value };
    }
    // A list carries no node-level accessor, so probe (a cheap range read) to know whether the text is
    // bulleted/numbered — a uniform list has uniform style and wouldn't trip the style-mix test, yet
    // its <ol>/<ul> structure must survive; segments (split on listOptions/indentation) recover it.
    // Gate the probe on a hard line break: a list is inherently multi-line (one paragraph per item),
    // so single-line text (the bulk of nodes — labels, buttons, headings) can't be a meaningful list
    // and skips the probe entirely. This keeps the hot path free of a per-text-node call while still
    // catching every real list. (A one-item single-line list is missed, as it already was on main.)
    const chars = typeof text.characters === 'string' ? text.characters : '';
    let hasList = false;
    if (chars.includes('\n') && typeof text.getRangeListOptions === 'function') {
      const lo = text.getRangeListOptions(0, chars.length);
      hasList =
        typeof lo === 'symbol' || (typeof lo === 'object' && lo !== null && lo.type !== 'NONE');
    }
    // Expand per-run styling when the node varies in style, carries a partial link, or is a list —
    // uniform plain text needs no segments.
    const needsSegments =
      out.fontSize === MIXED ||
      out.fontName === MIXED ||
      out.fills === MIXED ||
      out.textCase === MIXED ||
      out.textDecoration === MIXED ||
      linkMixed ||
      wrapMixed ||
      hasList;
    if (needsSegments && typeof text.getStyledTextSegments === 'function') {
      out.segments = serializeTextSegments(text);
    }
  }

  return out;
};

const isFontName = (value: unknown): value is FontName =>
  typeof value === 'object' && value !== null && 'family' in value && 'style' in value;

/**
 * Copy a Figma `FontName` onto the wire. `variationSettings` is what makes a variable font's weight
 * / slant / optical size visible at all — hand-picking `{ family, style }` (as every one of these
 * call sites used to) reports "Inter Regular" for text that is actually rendering at wght 650.
 * Absent on a static family and on editors predating the API, so it is copied conditionally:
 * `exactOptionalPropertyTypes` forbids writing the key as `undefined`.
 */
export const serializeFontName = (font: FontName): SerializedFontName => {
  const out: SerializedFontName = { family: font.family, style: font.style };
  if (font.variationSettings !== undefined) out.variationSettings = { ...font.variationSettings };
  return out;
};

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
  // Shadow bindings (colour / radius / spread / offsetX / offsetY) live on the effect itself; a
  // shadow whose colour is a variable otherwise reads as a hard-coded RGBA (issue #164).
  const bound = collectBindings((effect as { boundVariables?: unknown }).boundVariables);
  if (effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW') {
    return {
      type: effect.type,
      visible: effect.visible,
      radius: effect.radius,
      color: { r: effect.color.r, g: effect.color.g, b: effect.color.b, a: effect.color.a },
      offset: { x: effect.offset.x, y: effect.offset.y },
      spread: effect.spread ?? 0,
      ...(bound === undefined ? {} : { boundVariables: bound }),
    };
  }
  // Blurs / textures carry radius; noise / glass carry only type + visible.
  const out: SerializedEffect = { type: effect.type, visible: effect.visible };
  if ('radius' in effect && typeof effect.radius === 'number') out.radius = effect.radius;
  if (bound !== undefined) out.boundVariables = bound;
  return out;
};

/**
 * A variable's designer-declared code-side names ({ WEB / ANDROID / iOS → string }), dropping empty
 * strings (a cleared declaration). Returns undefined when nothing meaningful is declared, so
 * callers only emit the field when it carries real intent. Shared by get_variable_defs and
 * get_design_context's resolveTokens.
 */
export const serializeCodeSyntax = (raw: unknown): Record<string, string> | undefined => {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const out: Record<string, string> = {};
  for (const [platform, name] of Object.entries(raw)) {
    if (typeof name === 'string' && name !== '') out[platform] = name;
  }
  return Object.keys(out).length > 0 ? out : undefined;
};

export const serializeLayoutGrid = (grid: LayoutGrid): SerializedLayoutGrid => {
  // sectionSize / count / offset / gutterSize can each be variable-bound, on the grid object.
  const bound = collectBindings((grid as { boundVariables?: unknown }).boundVariables);
  if (grid.pattern === 'GRID') {
    return {
      pattern: 'GRID',
      visible: grid.visible ?? true,
      sectionSize: grid.sectionSize,
      ...(bound === undefined ? {} : { boundVariables: bound }),
    };
  }
  const out: SerializedLayoutGrid = {
    pattern: grid.pattern,
    visible: grid.visible ?? true,
    count: grid.count,
    gutterSize: grid.gutterSize,
    alignment: grid.alignment,
  };
  if (typeof grid.sectionSize === 'number') out.sectionSize = grid.sectionSize;
  // offset = the page margin between the grid and the frame edge (→ container horizontal padding).
  // Omit the no-op (0) and the CENTER case (which ignores offset) so only a real margin surfaces.
  if (typeof grid.offset === 'number' && grid.offset !== 0 && grid.alignment !== 'CENTER') {
    out.offset = grid.offset;
  }
  // Last, so a bound grid reads as "the grid, then what it binds" — the order every other
  // serializer here emits.
  if (bound !== undefined) out.boundVariables = bound;
  return out;
};
