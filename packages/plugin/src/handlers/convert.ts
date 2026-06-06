import type {
  SerializedAction,
  SerializedEffect,
  SerializedLayoutGrid,
  SerializedLineHeight,
  SerializedReaction,
  SerializedTrigger,
  SerializedVariableValue,
} from '@figma-mcp-relay/shared';

// Inverse of serializer.ts — turn the wire-format back into Figma API objects for write tools.
// (serializer.ts owns the Figma → wire direction; these are the matching wire → Figma helpers.)

/** Wire effect → Figma Effect. Shadows need color + offset; blurs need radius. */
export const toFigmaEffect = (e: SerializedEffect): Effect => {
  if (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') {
    if (e.color === undefined || e.offset === undefined) {
      throw new TypeError(`${e.type} requires color and offset`);
    }
    return {
      type: e.type,
      visible: e.visible,
      radius: e.radius ?? 0,
      color: { r: e.color.r, g: e.color.g, b: e.color.b, a: e.color.a },
      offset: { x: e.offset.x, y: e.offset.y },
      spread: e.spread ?? 0,
      blendMode: 'NORMAL',
    } as Effect;
  }
  if (e.type === 'LAYER_BLUR' || e.type === 'BACKGROUND_BLUR') {
    return { type: e.type, visible: e.visible, radius: e.radius ?? 0 } as Effect;
  }
  throw new TypeError(`unsupported effect type: ${e.type}`);
};

/** Wire layout grid → Figma LayoutGrid. GRID is uniform; ROWS/COLUMNS carry count + gutter. */
export const toFigmaLayoutGrid = (g: SerializedLayoutGrid): LayoutGrid => {
  if (g.pattern === 'GRID') {
    return { pattern: 'GRID', visible: g.visible, sectionSize: g.sectionSize ?? 10 };
  }
  if (g.pattern === 'ROWS' || g.pattern === 'COLUMNS') {
    return {
      pattern: g.pattern,
      visible: g.visible,
      alignment: g.alignment ?? 'STRETCH',
      gutterSize: g.gutterSize ?? 0,
      count: g.count ?? 1,
      offset: 0,
      ...(g.sectionSize === undefined ? {} : { sectionSize: g.sectionSize }),
    } as LayoutGrid;
  }
  throw new TypeError(`unsupported layout grid pattern: ${g.pattern}`);
};

/** Wire line height → Figma LineHeight (AUTO omits value). */
export const toFigmaLineHeight = (lh: SerializedLineHeight): LineHeight => {
  if (lh.unit === 'AUTO') return { unit: 'AUTO' };
  if (typeof lh.value !== 'number') {
    throw new TypeError(`lineHeight unit ${lh.unit} requires a numeric value`);
  }
  return { unit: lh.unit as 'PIXELS' | 'PERCENT', value: lh.value };
};

/** Wire variable value → Figma VariableValue (alias / color / primitive). */
export const toFigmaVariableValue = (value: SerializedVariableValue): VariableValue => {
  if (typeof value === 'object' && value !== null) {
    if ('r' in value) return { r: value.r, g: value.g, b: value.b, a: value.a };
    return { type: 'VARIABLE_ALIAS', id: value.id };
  }
  return value;
};

// Reactions: the Figma Action/Trigger types are strict discriminated unions, so we pass through the
// fields we serialized and cast — set_reactions is meant for round-tripping get_reactions output.
const toFigmaTrigger = (t: SerializedTrigger | null): Trigger | null => {
  if (t === null) return null;
  const out: Record<string, unknown> = { type: t.type };
  if (t.timeout !== undefined) out.timeout = t.timeout;
  if (t.delay !== undefined) out.delay = t.delay;
  return out as unknown as Trigger;
};

const toFigmaAction = (a: SerializedAction): Action => {
  const out: Record<string, unknown> = { type: a.type };
  if (a.destinationId !== undefined) out.destinationId = a.destinationId;
  if (a.navigation !== undefined) out.navigation = a.navigation;
  if (a.url !== undefined) out.url = a.url;
  if (a.transition !== undefined) out.transition = a.transition;
  return out as unknown as Action;
};

/** Wire reaction → Figma Reaction (modern `actions` array form). */
export const toFigmaReaction = (r: SerializedReaction): Reaction =>
  ({
    trigger: toFigmaTrigger(r.trigger),
    actions: r.actions.map(toFigmaAction),
  }) as unknown as Reaction;
