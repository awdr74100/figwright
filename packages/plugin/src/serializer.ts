import {
  MIXED,
  type SerializedAutoLayout,
  type SerializedComponentProperty,
  type SerializedEffect,
  type SerializedLayoutGrid,
  type SerializedLetterSpacing,
  type SerializedLineHeight,
  type SerializedNode,
  type SerializedPaint,
  type SerializedStyleIds,
  type SerializedTextSegment,
  serializeNode as serializeBase,
} from '@figma-mcp-relay/shared';

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
  return { type: paint.type, visible, opacity };
};

const serializeAutoLayout = (node: SceneNode): SerializedAutoLayout => {
  const n = node as SceneNode & {
    layoutMode: 'HORIZONTAL' | 'VERTICAL';
    paddingTop: number;
    paddingRight: number;
    paddingBottom: number;
    paddingLeft: number;
    itemSpacing: number;
    primaryAxisAlignItems: string;
    counterAxisAlignItems: string;
    layoutWrap?: string;
  };
  const out: SerializedAutoLayout = {
    mode: n.layoutMode,
    paddingTop: n.paddingTop,
    paddingRight: n.paddingRight,
    paddingBottom: n.paddingBottom,
    paddingLeft: n.paddingLeft,
    itemSpacing: n.itemSpacing,
    primaryAxisAlignItems: n.primaryAxisAlignItems,
    counterAxisAlignItems: n.counterAxisAlignItems,
  };
  if (typeof n.layoutWrap === 'string') out.layoutWrap = n.layoutWrap;
  return out;
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
    out.cornerRadius = typeof cr === 'number' ? cr : MIXED;
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
        const n = node as Record<string, unknown>;
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

export const serializeSceneNode = serializeFlat;

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
