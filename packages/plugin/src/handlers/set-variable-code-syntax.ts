import type { VariableResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { serializeCodeSyntax } from '../serializer.js';

// The exact platform literals Figma accepts (note the mixed-case 'iOS') — also the wire keys the
// read side (get_variable_defs / resolveTokens) emits verbatim, keeping write↔read symmetric.
const PLATFORMS = ['WEB', 'ANDROID', 'iOS'] as const;
type Platform = (typeof PLATFORMS)[number];

export const createSetVariableCodeSyntaxHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { variableId?: unknown; codeSyntax?: unknown };
    if (typeof p.variableId !== 'string') {
      throw new TypeError('set_variable_code_syntax: variableId must be a string');
    }
    if (typeof p.codeSyntax !== 'object' || p.codeSyntax === null) {
      throw new TypeError('set_variable_code_syntax: codeSyntax must be an object');
    }
    const entries = Object.entries(p.codeSyntax);
    if (entries.length === 0) {
      throw new TypeError(
        `set_variable_code_syntax: codeSyntax must declare at least one platform (${PLATFORMS.join(' / ')})`,
      );
    }
    for (const [platform, value] of entries) {
      if (!(PLATFORMS as readonly string[]).includes(platform)) {
        throw new TypeError(
          `set_variable_code_syntax: unknown platform "${platform}" — use ${PLATFORMS.join(' / ')}`,
        );
      }
      // null = remove; otherwise a non-empty name (an empty string is an ambiguous half-removal —
      // the read side would filter it, leaving a declaration that exists but never surfaces).
      if (value !== null && (typeof value !== 'string' || value === '')) {
        throw new TypeError(
          `set_variable_code_syntax: ${platform} must be a non-empty string, or null to remove`,
        );
      }
    }

    const variable = await figmaCtx.variables.getVariableByIdAsync(p.variableId);
    if (variable === null) {
      throw new Error(`set_variable_code_syntax: variable ${p.variableId} not found`);
    }

    for (const [platform, value] of entries) {
      if (value === null) variable.removeVariableCodeSyntax(platform as Platform);
      else variable.setVariableCodeSyntax(platform as Platform, value as string);
    }

    // Echo the declarations now in effect (read back off the variable, same shape as the read side)
    // so the caller can confirm the result without a second tool call.
    const result: VariableResult = { ok: true, variableId: variable.id, name: variable.name };
    const codeSyntax = serializeCodeSyntax(variable.codeSyntax);
    if (codeSyntax !== undefined) result.codeSyntax = codeSyntax;
    return result;
  };
