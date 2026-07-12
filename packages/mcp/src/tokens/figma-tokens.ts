import {
  type GetStylesResult,
  type GetVariableDefsResult,
  type SerializedVariable,
  type SerializedVariableCollection,
  type SerializedVariableValue,
  toHex,
} from '@figwright/shared';

// Figma token extraction — the left-hand (neutral provenance) side of the token join. Flattens
// get_variable_defs into { name, value, type } pairs by reading each variable at its collection's
// default mode, following VARIABLE_ALIAS chains to a concrete value, and rendering colors as the same
// hex form the grounding output uses (so value-matching against project tokens lines up). A variable
// in a multi-mode collection whose value actually changes across modes additionally carries `modes`
// (mode name → resolved value): the per-theme values (Light/Dark) that codegen must keep
// theme-aware rather than collapse into the default mode's literal. Pure.

/** A resolved concrete value: hex string for color, primitive otherwise; null if unresolved. */
type FigmaTokenValue = string | number | boolean | null;

export interface FigmaToken {
  /** Figma variable name, group separators kept, e.g. "Primary/500". */
  name: string;
  /** Resolved value at the collection's default mode. */
  value: FigmaTokenValue;
  /** Figma resolvedType: COLOR | FLOAT | STRING | BOOLEAN. */
  type: string;
  /**
   * Display name of the variable's collection, e.g. "font" / "color" / "size". Lets the join
   * disambiguate overloaded names — a "size/*" in a typography collection is a font size, while the
   * same name in a dimension collection is a width/height. Absent if the collection has no name.
   */
  collection?: string;
  /**
   * Per-theme values keyed by mode name (e.g. { Light: "#FFFFFF", Dark: "#0A0A0A" }), present only
   * when the variable's collection has more than one mode AND at least two modes resolve to
   * different values — i.e. the token is genuinely theme-dependent. `value` is only the default
   * mode; a consumer must not emit it as the token's sole literal when `modes` is set.
   */
  modes?: Record<string, FigmaTokenValue>;
  /**
   * Set to 'style' when this token was derived from a shared paint style rather than a variable —
   * the design-token mechanism of pre-variables Figma files. Absent for variables.
   */
  source?: 'style';
}

const isAlias = (val: SerializedVariableValue): val is { type: 'VARIABLE_ALIAS'; id: string } =>
  typeof val === 'object' && val !== null && (val as { type?: string }).type === 'VARIABLE_ALIAS';

const isRgba = (
  val: SerializedVariableValue,
): val is { r: number; g: number; b: number; a: number } =>
  typeof val === 'object' && val !== null && 'r' in val && 'g' in val && 'b' in val;

/** The mode being resolved, carried across alias hops so Light keeps chasing Light. */
interface ModeContext {
  modeId: string;
  name: string;
}

/**
 * The mode of `collection` to read under `ctx`: the exact mode when the hop stays in the same
 * collection, else the same-named mode (designers name theme modes identically across collections —
 * Light/Dark in both the semantic and the primitive collection, and matching by name is how the
 * themes are meant to switch together), else the collection's default — which mirrors Figma's own
 * resolution, where a collection that doesn't carry the consuming mode resolves at its default. A
 * null ctx (the plain default-mode read) always uses the default.
 */
const modeIn = (collection: SerializedVariableCollection, ctx: ModeContext | null): string => {
  if (ctx !== null) {
    if (collection.modes.some(m => m.modeId === ctx.modeId)) return ctx.modeId;
    const named =
      collection.modes.find(m => m.name === ctx.name) ??
      collection.modes.find(m => m.name.toLowerCase() === ctx.name.toLowerCase());
    if (named !== undefined) return named.modeId;
  }
  return collection.defaultModeId;
};

/**
 * Resolve get_variable_defs into a flat list of concrete Figma tokens. Aliases are chased to a
 * concrete value — at the collection's default mode for `value`, and once per mode (the mode
 * context following the alias across collections) for `modes` — with a visited-set cycle guard so a
 * self/mutual reference yields null rather than looping.
 */
export const resolveFigmaTokens = (defs: GetVariableDefsResult): FigmaToken[] => {
  const collectionById = new Map(defs.collections.map(c => [c.id, c]));
  const byId = new Map(defs.variables.map(varDef => [varDef.id, varDef]));

  /** Raw value of `variable` under `ctx` (falls back to its first mode when the mode is absent). */
  const valueAt = (
    variable: SerializedVariable,
    ctx: ModeContext | null,
  ): SerializedVariableValue | undefined => {
    const collection = collectionById.get(variable.collectionId);
    if (collection !== undefined) {
      const modeId = modeIn(collection, ctx);
      if (modeId in variable.valuesByMode) return variable.valuesByMode[modeId];
    }
    return Object.values(variable.valuesByMode)[0];
  };

  const resolve = (
    variable: SerializedVariable,
    ctx: ModeContext | null,
    seen: Set<string>,
  ): FigmaTokenValue => {
    if (seen.has(variable.id)) return null;
    seen.add(variable.id);
    const raw = valueAt(variable, ctx);
    if (raw === undefined) return null;
    if (isAlias(raw)) {
      const target = byId.get(raw.id);
      return target === undefined ? null : resolve(target, ctx, seen);
    }
    if (isRgba(raw)) return toHex(raw, raw.a);
    return raw;
  };

  /**
   * Per-theme values for a variable in a multi-mode collection, or undefined when every mode
   * resolves to the same value (an identical-everywhere value isn't theme-dependent, and emitting
   * it would bloat every mapping in a multi-mode file for no signal).
   */
  const modesOf = (variable: SerializedVariable): FigmaToken['modes'] => {
    const collection = collectionById.get(variable.collectionId);
    if (collection === undefined || collection.modes.length < 2) return undefined;
    const out: NonNullable<FigmaToken['modes']> = {};
    for (const mode of collection.modes) {
      // Duplicate mode names can't be told apart as record keys; qualify the later one by id.
      const key = mode.name in out ? `${mode.name} (${mode.modeId})` : mode.name;
      out[key] = resolve(variable, { modeId: mode.modeId, name: mode.name }, new Set());
    }
    const values = Object.values(out);
    return values.some(v => v !== values[0]) ? out : undefined;
  };

  return defs.variables.map(variable => {
    const collection = collectionById.get(variable.collectionId);
    const name = collection?.name;
    const modes = modesOf(variable);
    return {
      name: variable.name,
      value: resolve(variable, null, new Set()),
      type: variable.resolvedType,
      ...(name === undefined || name.length === 0 ? {} : { collection: name }),
      ...(modes === undefined ? {} : { modes }),
    };
  });
};

/**
 * Pseudo-tokens from shared paint styles — the design-token mechanism of pre-variables Figma files
 * (a document can carry a full palette as paint styles and zero variables, leaving the variable
 * join empty-handed). Only a style that is exactly one visible SOLID paint converts: that is the
 * shape that IS a color token by another name. Multi-paint, gradient, and image styles are looks,
 * not tokens, and are skipped. Pure.
 */
export const resolvePaintStyleTokens = (paints: GetStylesResult['paints']): FigmaToken[] => {
  const out: FigmaToken[] = [];
  for (const style of paints) {
    const visible = style.paints.filter(p => p.visible !== false);
    const only = visible.length === 1 ? visible[0] : undefined;
    if (only === undefined || only.type !== 'SOLID' || !('color' in only)) continue;
    out.push({
      name: style.name,
      value: toHex(only.color, only.opacity),
      type: 'COLOR',
      source: 'style',
    });
  }
  return out;
};
