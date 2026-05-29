import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const SET_VARIABLE_VALUE_TOOL_NAME = 'set_variable_value';

// A real union (vs the old `type: ['boolean','number','string','object']` workaround) is load-bearing:
// an untyped property gets coerced to a string by some MCP clients in transit, which then fails
// Figma's setValueForMode type check for every non-STRING variable. Naming each member keeps the
// derived JSON Schema explicit and lets McpServer reject mistyped values up front. The object
// variants are loose (a color may round-trip from get_variable_defs with extra keys); the plugin
// also coerces by resolvedType as a belt-and-suspenders guard.
const variableValue = z
  .union([
    z.boolean(),
    z.number(),
    z.string(),
    z.looseObject({ r: z.number(), g: z.number(), b: z.number(), a: z.number().optional() }),
    z.looseObject({ type: z.literal('VARIABLE_ALIAS'), id: z.string() }),
  ])
  .describe('boolean | number | string | { r,g,b,a } | { type:"VARIABLE_ALIAS", id }');

export const setVariableValueTool: ToolSpec = {
  name: SET_VARIABLE_VALUE_TOOL_NAME,
  description:
    "Set a variable's value for a mode. value is a boolean / number / string, a color " +
    '{ r, g, b, a } (0–1), or an alias { type: "VARIABLE_ALIAS", id }. Returns { ok, variableId, name }.',
  inputShape: {
    variableId: z.string().describe('Variable id'),
    modeId: z.string().describe('Mode id (from the collection)'),
    value: variableValue,
  },
  kind: 'write',
};
