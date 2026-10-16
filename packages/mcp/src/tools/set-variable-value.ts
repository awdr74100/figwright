import { z } from 'zod';

import { colorSpaceSchema } from './color-space-schema.js';
import { variableEasingSchema } from './motion-schemas.js';
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
    z.looseObject({
      r: z.number(),
      g: z.number(),
      b: z.number(),
      a: z.number().optional(),
      space: colorSpaceSchema.optional(),
    }),
    z.looseObject({ type: z.literal('VARIABLE_ALIAS'), id: z.string() }),
    // A composed color (plugin-typings 1.139): a color and its opacity authored separately, with an
    // alias on at least one half. It nests the keys the members around it are keyed by rather than
    // carrying them, so it cannot be swallowed by either and its position is not load-bearing.
    z.looseObject({
      color: z.union([
        z.looseObject({
          r: z.number(),
          g: z.number(),
          b: z.number(),
          a: z.number().optional(),
          space: colorSpaceSchema.optional(),
        }),
        z.looseObject({ type: z.literal('VARIABLE_ALIAS'), id: z.string() }),
      ]),
      opacity: z.union([
        z.number(),
        z.looseObject({ type: z.literal('VARIABLE_ALIAS'), id: z.string() }),
      ]),
    }),
    // An EASING variable's curve, with the requirement every Motion easing input has. Its `type`
    // enum has no VARIABLE_ALIAS, so it cannot swallow the alias member above.
    variableEasingSchema,
  ])
  .describe(
    'boolean | number | string | { r,g,b,a, space? } | { type:"VARIABLE_ALIAS", id } | ' +
      '{ color, opacity } composed color | { type: easing }',
  );

export const setVariableValueTool: ToolSpec = {
  name: SET_VARIABLE_VALUE_TOOL_NAME,
  description:
    "Set a variable's value for one mode (modeId comes from the variable's collection). value must " +
    'match the variable resolvedType: a boolean, a number (FLOAT), a string, a color { r, g, b, a } ' +
    '(0–1, in the document\'s colour space unless `space` names another — pass "SRGB" for a ' +
    'colour taken from code), an alias { type: "VARIABLE_ALIAS", id } pointing at another ' +
    'variable, or a composed color { color, opacity } that pairs a color with a separate opacity — ' +
    'each half either a ' +
    'concrete value or an alias, with at least one of the two an alias. An EASING variable takes a ' +
    'Motion easing, a TIMING variable a number of seconds. Create the variable first with ' +
    'create_variable. Returns { ok, variableId, name }.',
  inputSchema: z.object({
    variableId: z.string().describe('Variable id'),
    modeId: z.string().describe('Mode id (from the collection)'),
    value: variableValue,
  }),
  kind: 'write',
};
