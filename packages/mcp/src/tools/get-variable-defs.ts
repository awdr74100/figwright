import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const GET_VARIABLE_DEFS_TOOL_NAME = 'get_variable_defs';

export const getVariableDefsTool: ToolSpec = {
  name: GET_VARIABLE_DEFS_TOOL_NAME,
  description:
    "Return the document's local variables as { collections, variables }. Each collection lists its modes " +
    'and defaultModeId; each variable lists its resolvedType and valuesByMode (primitives, RGBA colors, ' +
    '{ type: "VARIABLE_ALIAS", id } references to other variables, a composed color ' +
    '{ color, opacity } pairing a color with a separate opacity where either half may be an alias, ' +
    'or — for an EASING variable — an easing curve ' +
    '{ type, easingFunctionCubicBezier?, easingFunctionSpring? }). A variable also carries scopes ' +
    'when the designer narrowed where Figma offers it (e.g. ["CORNER_RADIUS"]) — authoritative ' +
    'intent about what the token is for; absent means every scope.',
  inputSchema: z.object({}),
  kind: 'read',
};
