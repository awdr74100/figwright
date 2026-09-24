import {
  type GetVariableDefsResult,
  type SerializedMotionEasing,
  type SerializedVariableColor,
  type SerializedVariableComposedColor,
  type SerializedVariableValue,
  toHex,
} from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { serializeCodeSyntax } from '../serializer.js';

const serializeMotionEasing = (easing: MotionEasing): SerializedMotionEasing => {
  const out: SerializedMotionEasing = { type: easing.type };
  const bezier = easing.easingFunctionCubicBezier;
  if (bezier !== undefined) {
    out.easingFunctionCubicBezier = { x1: bezier.x1, y1: bezier.y1, x2: bezier.x2, y2: bezier.y2 };
  }
  if (easing.easingFunctionSpring !== undefined) {
    out.easingFunctionSpring = { bounce: easing.easingFunctionSpring.bounce };
  }
  return out;
};

/**
 * An RGB/RGBA color value. `hex` mirrors get_design_context's globalVars (#RRGGBB / #RRGGBBAA) so a
 * bound color resolves in one tool, without hand-converting normalised RGBA. RGBA channels stay for
 * back-compat. An RGB without alpha normalises to a = 1.
 */
const serializeColor = (color: RGB | RGBA): SerializedVariableColor => {
  const a = 'a' in color ? color.a : 1;
  return { r: color.r, g: color.g, b: color.b, a, hex: toHex(color, a) };
};

/**
 * A composed color (plugin-typings 1.139): a color and its opacity authored separately, at least
 * one of the two an alias. Each half is serialized on its own terms so an alias keeps its `id` —
 * the flattening to a single hex belongs to token_map, which needs one scalar, not to this read
 * path, which should say what the file actually holds.
 */
const serializeComposedColor = (value: VariableComposedColor): SerializedVariableComposedColor => ({
  color:
    'type' in value.color
      ? { type: 'VARIABLE_ALIAS', id: value.color.id }
      : serializeColor(value.color),
  opacity:
    typeof value.opacity === 'number'
      ? value.opacity
      : { type: 'VARIABLE_ALIAS', id: value.opacity.id },
});

const serializeVariableValue = (value: VariableValue): SerializedVariableValue => {
  if (typeof value === 'object' && value !== null) {
    if ('type' in value && value.type === 'VARIABLE_ALIAS') {
      return { type: 'VARIABLE_ALIAS', id: value.id };
    }
    // An EASING variable's value is a MotionEasing: it carries a `type` but no color channels, so it
    // has to be caught before the color fallback below. That fallback reads whatever is left as RGB,
    // which for an easing curve yields r/g/b: undefined and a "#NANNANNAN" hex — a fabricated color
    // rather than a missing field, which no gate would flag downstream.
    if ('type' in value) return serializeMotionEasing(value);
    // A composed color falls into that same fallback for the same reason — it carries no `type`
    // either, only `color` + `opacity` — and was measured producing exactly that "#NANNANNAN".
    if ('color' in value && 'opacity' in value) return serializeComposedColor(value);
    return serializeColor(value);
  }
  return value;
};

export const createGetVariableDefsHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async () => {
    const [collections, variables] = await Promise.all([
      figmaCtx.variables.getLocalVariableCollectionsAsync(),
      figmaCtx.variables.getLocalVariablesAsync(),
    ]);

    const result: GetVariableDefsResult = {
      collections: collections.map(c => ({
        id: c.id,
        name: c.name,
        key: c.key,
        defaultModeId: c.defaultModeId,
        modes: c.modes.map(m => ({ modeId: m.modeId, name: m.name })),
        variableIds: [...c.variableIds],
      })),
      variables: variables.map(varDef => {
        const out: GetVariableDefsResult['variables'][number] = {
          id: varDef.id,
          name: varDef.name,
          key: varDef.key,
          resolvedType: varDef.resolvedType,
          collectionId: varDef.variableCollectionId,
          valuesByMode: Object.fromEntries(
            Object.entries(varDef.valuesByMode).map(([modeId, value]) => [
              modeId,
              serializeVariableValue(value),
            ]),
          ),
        };
        // Designer-declared code-side name (e.g. WEB → `--color-primary`) — authoritative naming
        // intent that skips the heuristic name join; only emitted when actually declared.
        const codeSyntax = serializeCodeSyntax(varDef.codeSyntax);
        if (codeSyntax !== undefined) out.codeSyntax = codeSyntax;
        // Which fields Figma offers this variable for — the designer's own statement of intent,
        // which the name-based token join can only guess at. Figma defaults every variable to
        // ['ALL_SCOPES'], so emitting that would cost payload on every variable and say nothing;
        // only a deliberate narrowing is reported.
        const scopes = varDef.scopes;
        if (!(scopes.length === 1 && scopes[0] === 'ALL_SCOPES')) out.scopes = [...scopes];
        return out;
      }),
    };
    return result;
  };
