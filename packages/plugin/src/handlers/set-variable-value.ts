import type { SerializedVariableValue, VariableResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { toFigmaVariableValue } from './convert.js';

/**
 * Some MCP clients serialize a schema-untyped property to a string in transit, so `value` can
 * arrive as e.g. "42" / "true" / '{"r":..}' even though the caller passed a number / boolean /
 * object. We know the variable's resolvedType, so realign the value to it — otherwise Figma's
 * setValueForMode rejects every non-STRING variable with a "Mismatched variable resolved type"
 * error.
 */
const coerceToResolvedType = (raw: unknown, resolvedType: VariableResolvedDataType): unknown => {
  if (typeof raw !== 'string') return raw; // native type survived transit — nothing to fix
  // A stringified object is an alias ({ type: 'VARIABLE_ALIAS', id }) or RGBA color. Parse it back
  // before any per-type scalar coercion so it survives for *every* resolvedType — notably a FLOAT
  // variable aliased to another FLOAT, which the Number() branch below would otherwise NaN and strip
  // (the asymmetry behind figma-mcp-go #22: COLOR aliases survived, float aliases didn't).
  if (raw.trimStart().startsWith('{')) {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      throw new TypeError(`set_variable_value: "${raw}" is not valid JSON`);
    }
  }
  // TIMING is a duration, so it coerces exactly like FLOAT — a bare string can only mean a number.
  // Figma currently rejects writing TIMING/EASING at all (see create-variable.ts), so these two
  // arms only shape the value on its way to that rejection; they are here for when it opens up.
  if (resolvedType === 'FLOAT' || resolvedType === 'TIMING') {
    const n = Number(raw);
    if (Number.isNaN(n)) throw new TypeError(`set_variable_value: "${raw}" is not a number`);
    return n;
  }
  if (resolvedType === 'BOOLEAN') return raw === 'true';
  if (resolvedType === 'COLOR' || resolvedType === 'EASING') {
    // COLOR (RGBA or alias) and EASING (a MotionEasing curve) must both arrive as a JSON object —
    // the branch above already returned for anything that parsed, so a bare string here is invalid.
    throw new TypeError(`set_variable_value: ${resolvedType} value "${raw}" is not valid JSON`);
  }
  return raw; // STRING
};

export const createSetVariableValueHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { variableId?: unknown; modeId?: unknown; value?: unknown };
    if (typeof p.variableId !== 'string') {
      throw new TypeError('set_variable_value: variableId must be a string');
    }
    if (typeof p.modeId !== 'string')
      throw new TypeError('set_variable_value: modeId must be a string');
    if (p.value === undefined) throw new TypeError('set_variable_value: value is required');

    const variable = await figmaCtx.variables.getVariableByIdAsync(p.variableId);
    if (variable === null) {
      throw new Error(`set_variable_value: variable ${p.variableId} not found`);
    }
    const value = coerceToResolvedType(p.value, variable.resolvedType);
    variable.setValueForMode(p.modeId, toFigmaVariableValue(value as SerializedVariableValue));

    const result: VariableResult = { ok: true, variableId: variable.id, name: variable.name };
    return result;
  };
