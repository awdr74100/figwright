import {
  type GetVariableDefsResult,
  type SerializedVariable,
  type SerializedVariableValue,
  toHex,
} from '@figwright/shared';

// Figma token extraction — the left-hand (neutral provenance) side of the token join. Flattens
// get_variable_defs into { name, value, type } pairs by reading each variable at its collection's
// default mode, following VARIABLE_ALIAS chains to a concrete value, and rendering colors as the same
// hex form the grounding output uses (so value-matching against project tokens lines up). Pure.

export interface FigmaToken {
  /** Figma variable name, group separators kept, e.g. "Primary/500". */
  name: string;
  /** Resolved value: hex string for color, number / string / boolean for others; null if unresolved. */
  value: string | number | boolean | null;
  /** Figma resolvedType: COLOR | FLOAT | STRING | BOOLEAN. */
  type: string;
  /**
   * Display name of the variable's collection, e.g. "font" / "color" / "size". Lets the join
   * disambiguate overloaded names — a "size/*" in a typography collection is a font size, while the
   * same name in a dimension collection is a width/height. Absent if the collection has no name.
   */
  collection?: string;
}

const isAlias = (val: SerializedVariableValue): val is { type: 'VARIABLE_ALIAS'; id: string } =>
  typeof val === 'object' && val !== null && (val as { type?: string }).type === 'VARIABLE_ALIAS';

const isRgba = (
  val: SerializedVariableValue,
): val is { r: number; g: number; b: number; a: number } =>
  typeof val === 'object' && val !== null && 'r' in val && 'g' in val && 'b' in val;

/** Value at a variable's default mode (falls back to its first mode when defaultModeId is absent). */
const valueAtDefaultMode = (
  variable: SerializedVariable,
  defaultModeId: string | undefined,
): SerializedVariableValue | undefined => {
  if (defaultModeId !== undefined && defaultModeId in variable.valuesByMode) {
    return variable.valuesByMode[defaultModeId];
  }
  return Object.values(variable.valuesByMode)[0];
};

/**
 * Resolve get_variable_defs into a flat list of concrete Figma tokens. Aliases are chased to their
 * target's default-mode value, with a visited-set cycle guard so a self/mutual reference yields
 * null rather than looping.
 */
export const resolveFigmaTokens = (defs: GetVariableDefsResult): FigmaToken[] => {
  const defaultModeByCollection = new Map(defs.collections.map(c => [c.id, c.defaultModeId]));
  const nameByCollection = new Map(defs.collections.map(c => [c.id, c.name]));
  const byId = new Map(defs.variables.map(varDef => [varDef.id, varDef]));

  const resolve = (variable: SerializedVariable, seen: Set<string>): FigmaToken['value'] => {
    if (seen.has(variable.id)) return null;
    seen.add(variable.id);
    const raw = valueAtDefaultMode(variable, defaultModeByCollection.get(variable.collectionId));
    if (raw === undefined) return null;
    if (isAlias(raw)) {
      const target = byId.get(raw.id);
      return target === undefined ? null : resolve(target, seen);
    }
    if (isRgba(raw)) return toHex(raw, raw.a);
    return raw;
  };

  return defs.variables.map(variable => {
    const collection = nameByCollection.get(variable.collectionId);
    return {
      name: variable.name,
      value: resolve(variable, new Set()),
      type: variable.resolvedType,
      ...(collection === undefined || collection.length === 0 ? {} : { collection }),
    };
  });
};
