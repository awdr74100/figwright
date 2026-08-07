import {
  type GetVariableDefsResult,
  type SerializedMotionEasing,
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

const serializeVariableValue = (value: VariableValue): SerializedVariableValue => {
  if (typeof value === 'object' && value !== null) {
    if ('type' in value && value.type === 'VARIABLE_ALIAS') {
      return { type: 'VARIABLE_ALIAS', id: value.id };
    }
    // An EASING variable's value is a MotionEasing: it carries a `type` but no color channels, so it
    // has to be caught before the color fallback below. That fallback casts whatever is left to RGB,
    // which for an easing curve yields r/g/b: undefined and a "#NANNANNAN" hex — a fabricated color
    // rather than a missing field, which no gate would flag downstream.
    if ('type' in value) return serializeMotionEasing(value);
    const color = value as RGB | RGBA;
    const a = 'a' in color ? color.a : 1;
    // hex mirrors get_design_context's globalVars (#RRGGBB / #RRGGBBAA) so a bound color resolves in
    // one tool, without hand-converting normalised RGBA. RGBA channels stay for back-compat.
    return { r: color.r, g: color.g, b: color.b, a, hex: toHex(color, a) };
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
        return out;
      }),
    };
    return result;
  };
