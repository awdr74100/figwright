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
    // An EASING variable's curve. Figma refuses to edit EASING variables at all today, so this
    // member exists to let such a call through to that explicit error rather than bounce off a
    // schema mismatch. It must stay after the alias member: both are objects keyed by `type`, and
    // this one accepts any string, so it would otherwise swallow aliases.
    z.looseObject({
      type: z.string(),
      easingFunctionCubicBezier: z
        .looseObject({ x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number() })
        .optional(),
      easingFunctionSpring: z.looseObject({ bounce: z.number() }).optional(),
    }),
  ])
  .describe(
    'boolean | number | string | { r,g,b,a } | { type:"VARIABLE_ALIAS", id } | { type: easing }',
  );

export const setVariableValueTool: ToolSpec = {
  name: SET_VARIABLE_VALUE_TOOL_NAME,
  description:
    "Set a variable's value for one mode (modeId comes from the variable's collection). value must " +
    'match the variable resolvedType: a boolean, a number (FLOAT), a string, a color { r, g, b, a } ' +
    '(0–1), or an alias { type: "VARIABLE_ALIAS", id } pointing at another variable. EASING and ' +
    'TIMING variables are read-only to plugins — Figma rejects editing them, so read them with ' +
    'get_variable_defs and change them in the Figma UI instead. Create the variable first with ' +
    'create_variable. Returns { ok, variableId, name }.',
  inputSchema: z.object({
    variableId: z.string().describe('Variable id'),
    modeId: z.string().describe('Mode id (from the collection)'),
    value: variableValue,
  }),
  kind: 'write',
};
