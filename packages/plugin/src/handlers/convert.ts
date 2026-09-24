import type {
  SerializedAction,
  SerializedEffect,
  SerializedLayoutGrid,
  SerializedLineHeight,
  SerializedReaction,
  SerializedTrigger,
  SerializedVariableComposedColor,
  SerializedVariableValue,
} from '@figwright/shared';

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
    const alignment = g.alignment ?? 'STRETCH';
    return {
      pattern: g.pattern,
      visible: g.visible,
      alignment,
      gutterSize: g.gutterSize ?? 0,
      count: g.count ?? 1,
      // Figma rejects `offset` on a CENTER grid at runtime (it's ignored there) — only MIN/MAX/STRETCH
      // accept it. Omit it for CENTER so a valid centered grid isn't rejected for carrying the key.
      ...(alignment === 'CENTER' ? {} : { offset: g.offset ?? 0 }),
      ...(g.sectionSize === undefined ? {} : { sectionSize: g.sectionSize }),
    } as LayoutGrid;
  }
  throw new TypeError(`unsupported layout grid pattern: ${g.pattern}`);
};

/**
 * Wire font → Figma `FontNameInput`. `style` is optional: Figma then resolves the named instance
 * closest to `variationSettings`, which is how a caller holding a CSS weight expresses itself
 * without knowing what the family calls that instance. Rebuilt field by field rather than passed
 * through, so nothing beyond the three known keys reaches `figma.*`.
 */
export const toFigmaFontName = (fn: {
  family?: unknown;
  style?: unknown;
  variationSettings?: unknown;
}): FontNameInput => {
  if (typeof fn.family !== 'string') throw new TypeError('fontName.family must be a string');
  // Built mutably — `FontNameInput`'s own fields are readonly, and the result is assignable to it.
  const out: { family: string; style?: string; variationSettings?: Record<string, number> } = {
    family: fn.family,
  };
  if (fn.style !== undefined) {
    if (typeof fn.style !== 'string') throw new TypeError('fontName.style must be a string');
    out.style = fn.style;
  }
  if (fn.variationSettings !== undefined) {
    if (typeof fn.variationSettings !== 'object' || fn.variationSettings === null) {
      throw new TypeError('fontName.variationSettings must be an object of axis tag → number');
    }
    const axes: Record<string, number> = {};
    for (const [tag, value] of Object.entries(fn.variationSettings)) {
      if (typeof value !== 'number') {
        throw new TypeError(`fontName.variationSettings.${tag} must be a number`);
      }
      axes[tag] = value;
    }
    out.variationSettings = axes;
  }
  return out;
};

/** Wire line height → Figma LineHeight (AUTO omits value). */
export const toFigmaLineHeight = (lh: SerializedLineHeight): LineHeight => {
  if (lh.unit === 'AUTO') return { unit: 'AUTO' };
  if (typeof lh.value !== 'number') {
    throw new TypeError(`lineHeight unit ${lh.unit} requires a numeric value`);
  }
  return { unit: lh.unit as 'PIXELS' | 'PERCENT', value: lh.value };
};

/**
 * Wire composed color → Figma VariableComposedColor (plugin-typings 1.139).
 *
 * Figma's type admits the pair only when at least one half is an alias: a concrete colour at a
 * concrete opacity is just an RGBA and there is nothing to compose. Rejecting that combination here
 * rather than casting past it means the agent is told what to send instead, at the tool boundary,
 * rather than meeting an opaque refusal from Figma.
 */
const toFigmaComposedColor = (value: SerializedVariableComposedColor): VariableComposedColor => {
  const opacity =
    typeof value.opacity === 'number'
      ? value.opacity
      : ({ type: 'VARIABLE_ALIAS', id: value.opacity.id } as const);
  if ('r' in value.color) {
    if (typeof opacity === 'number') {
      throw new TypeError(
        'set_variable_value: a composed color needs an alias on at least one of color / opacity — ' +
          'a concrete color at a concrete opacity is just { r, g, b, a }',
      );
    }
    const { r, g, b, a } = value.color;
    return { color: { r, g, b, a }, opacity };
  }
  return { color: { type: 'VARIABLE_ALIAS', id: value.color.id }, opacity };
};

/** Wire variable value → Figma VariableValue (alias / color / composed color / easing / primitive). */
export const toFigmaVariableValue = (value: SerializedVariableValue): VariableValue => {
  if (typeof value === 'object' && value !== null) {
    if ('r' in value) return { r: value.r, g: value.g, b: value.b, a: value.a };
    // A composed color nests the keys the other branches look for (`r` inside `color`, `id` inside
    // either half) rather than carrying them, so it is recognised by carrying both of its own and
    // neither of theirs. The tool schema's members are loose objects, which keep unknown keys, so a
    // malformed RGBA that also carried a stray `color` would land here if this were tried first —
    // and `'r' in value.color` would then throw on a non-object.
    if ('color' in value && 'opacity' in value) return toFigmaComposedColor(value);
    // Only an alias carries `id`; an EASING value carries its own `type` (EASE_IN / CUSTOM_SPRING /
    // …) instead. Keying on `id` rather than falling through keeps an easing curve from being turned
    // into an alias with `id: undefined`, which Figma would reject.
    if ('id' in value) return { type: 'VARIABLE_ALIAS', id: value.id };
    return value as unknown as VariableValue;
  }
  return value;
};

// Reactions: the Figma Action/Trigger types are strict discriminated unions, so we hand the wire
// object over whole and cast. Whitelisting fields here is what makes a round-trip lossy — the
// per-variant required fields (ON_KEY_DOWN's keyCodes, SET_VARIABLE's variableId, a directional
// transition's direction/matchLayers, an overlay's overlayRelativePosition) are precisely the ones
// no shared subset contains. setReactionsAsync validates the result, so a shape Figma cannot use is
// rejected there rather than applied.
const toFigmaTrigger = (t: SerializedTrigger | null): Trigger | null =>
  t === null ? null : ({ ...t } as unknown as Trigger);

const toFigmaAction = (a: SerializedAction): Action => ({ ...a }) as unknown as Action;

/** Wire reaction → Figma Reaction (modern `actions` array form). */
export const toFigmaReaction = (r: SerializedReaction): Reaction =>
  ({
    trigger: toFigmaTrigger(r.trigger),
    actions: r.actions.map(toFigmaAction),
  }) as unknown as Reaction;
