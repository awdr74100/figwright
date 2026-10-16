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

import { documentColorProfile } from './color-profile.js';

// Inverse of serializer.ts — turn the wire-format back into Figma API objects for write tools.
// (serializer.ts owns the Figma → wire direction; these are the matching wire → Figma helpers.)

/** The colour spaces a write may name its channels in. */
const COLOR_SPACES = ['SRGB', 'DISPLAY_P3'] as const;

/**
 * A colour as a write tool receives it. Figma stores every colour in the document's own colour
 * space — a Display P3 file holds P3 channels — and reads report them that way, so a colour written
 * without `space` is taken as document channels and round-trips unchanged. `space` says the
 * channels are in another space instead: a colour taken from code is sRGB, and written raw into a
 * P3 file it would paint a more saturated colour than the code shows.
 */
interface WireColor {
  r: number;
  g: number;
  b: number;
  space?: unknown;
}

/**
 * Wire colour → the document's channels. A colour that names no space passes through as it is, and
 * so does one already in the document's space — so an sRGB or unmanaged file writes exactly the
 * channels it always did, whatever `space` says, with nothing left to Figma's conversion
 * arithmetic. Only a colour in the other space is handed to Figma's conversion, which maps it into
 * the document's profile and records the space as the colour's `sourceColor`. The document is read
 * only once a colour names a space.
 */
export const toDocumentRgb = (figmaCtx: typeof figma, c: WireColor, where: string): RGB => {
  if (c.space === undefined) return { r: c.r, g: c.g, b: c.b };
  if (!COLOR_SPACES.includes(c.space as (typeof COLOR_SPACES)[number])) {
    throw new TypeError(
      `${where}: color space must be one of ${COLOR_SPACES.join(' / ')} — got ${String(c.space)}`,
    );
  }
  const space = c.space as (typeof COLOR_SPACES)[number];
  // An unmanaged (LEGACY) file reads its colours as sRGB, like one with no profile at all.
  const documentSpace = documentColorProfile(figmaCtx) === 'DISPLAY_P3' ? 'DISPLAY_P3' : 'SRGB';
  if (space === documentSpace) return { r: c.r, g: c.g, b: c.b };
  return figmaCtx.util.rgb({ space, r: c.r, g: c.g, b: c.b });
};

/**
 * {@link toDocumentRgb} reduced to bare channels, for a variable value: `setValueForMode` rejects
 * the `sourceColor` Figma's conversion attaches ("Unrecognized key(s) in object: 'sourceColor'"),
 * where a paint or an effect keeps it.
 */
const toDocumentChannels = (figmaCtx: typeof figma, c: WireColor, where: string): RGB => {
  const { r, g, b } = toDocumentRgb(figmaCtx, c, where);
  return { r, g, b };
};

/** {@link toDocumentRgb} for a colour that carries alpha, which no colour space changes. */
export const toDocumentRgba = (
  figmaCtx: typeof figma,
  c: WireColor & { a: number },
  where: string,
): RGBA => ({
  ...toDocumentRgb(figmaCtx, c, where),
  a: c.a,
});

/**
 * Wire effect → Figma Effect. Shadows need color + offset; blurs need radius.
 *
 * A drop shadow always states `showShadowBehindNode`. Left out, Figma stores `true` — the shadow
 * then shows through the node's translucent areas — though the typings say it defaults to `false`
 * (measured: written without it, a shadow behind a 30%-opaque box drew through it). A CSS
 * `box-shadow` never draws there, which is Figma's `false`, and a read carries the field only when
 * it is `true`, so a shadow taken from code, or read and written back, means `false` unless it says
 * otherwise. A shadow's blend mode carries over the same way, normal when none is given.
 */
export const toFigmaEffect = (e: SerializedEffect, figmaCtx: typeof figma): Effect => {
  if (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') {
    if (e.color === undefined || e.offset === undefined) {
      throw new TypeError(`${e.type} requires color and offset`);
    }
    const shadow: Record<string, unknown> = {
      type: e.type,
      visible: e.visible,
      radius: e.radius ?? 0,
      color: toDocumentRgba(figmaCtx, e.color, e.type),
      offset: { x: e.offset.x, y: e.offset.y },
      spread: e.spread ?? 0,
      blendMode: typeof e.blendMode === 'string' ? e.blendMode : 'NORMAL',
    };
    if (e.type === 'DROP_SHADOW') {
      shadow.showShadowBehindNode =
        (e as { showShadowBehindNode?: unknown }).showShadowBehindNode === true;
    }
    return shadow as unknown as Effect;
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
const toFigmaComposedColor = (
  value: SerializedVariableComposedColor,
  figmaCtx: typeof figma,
): VariableComposedColor => {
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
    const { a } = value.color;
    return {
      color: { ...toDocumentChannels(figmaCtx, value.color, 'set_variable_value'), a },
      opacity,
    } as VariableComposedColor;
  }
  return { color: { type: 'VARIABLE_ALIAS', id: value.color.id }, opacity };
};

/** Wire variable value → Figma VariableValue (alias / color / composed color / easing / primitive). */
export const toFigmaVariableValue = (
  value: SerializedVariableValue,
  figmaCtx: typeof figma,
): VariableValue => {
  if (typeof value === 'object' && value !== null) {
    if ('r' in value) {
      return {
        ...toDocumentChannels(figmaCtx, value, 'set_variable_value'),
        a: value.a,
      } as VariableValue;
    }
    // A composed color nests the keys the other branches look for (`r` inside `color`, `id` inside
    // either half) rather than carrying them, so it is recognised by carrying both of its own and
    // neither of theirs. The tool schema's members are loose objects, which keep unknown keys, so a
    // malformed RGBA that also carried a stray `color` would land here if this were tried first —
    // and `'r' in value.color` would then throw on a non-object.
    if ('color' in value && 'opacity' in value) return toFigmaComposedColor(value, figmaCtx);
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
