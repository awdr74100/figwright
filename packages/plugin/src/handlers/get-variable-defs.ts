import { type GetVariableDefsResult, type SerializedVariableValue, toHex } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

const serializeVariableValue = (value: VariableValue): SerializedVariableValue => {
  if (typeof value === 'object' && value !== null) {
    if ('type' in value && value.type === 'VARIABLE_ALIAS') {
      return { type: 'VARIABLE_ALIAS', id: value.id };
    }
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
      variables: variables.map(varDef => ({
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
      })),
    };
    return result;
  };
