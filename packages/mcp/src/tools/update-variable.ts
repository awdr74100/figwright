import { z } from 'zod';

import { variableScopesSchema } from './create-variable.js';
import type { ToolSpec } from './spec.js';

export const UPDATE_VARIABLE_TOOL_NAME = 'update_variable';

export const updateVariableTool: ToolSpec = {
  name: UPDATE_VARIABLE_TOOL_NAME,
  description:
    "Update a variable in place — its name, description, scopes (where Figma's picker offers it) " +
    'and whether it is published with the library. Its id, its values and every binding to it ' +
    'stay. Any field may be omitted to leave it unchanged. Scopes replace the whole list: a COLOR ' +
    'variable takes ALL_SCOPES / ALL_FILLS / FRAME_FILL / SHAPE_FILL / TEXT_FILL / STROKE_COLOR / ' +
    'EFFECT_COLOR; FLOAT takes ALL_SCOPES, TEXT_CONTENT, CORNER_RADIUS, WIDTH_HEIGHT, GAP, ' +
    'STROKE_FLOAT, EFFECT_FLOAT, OPACITY, COLOR_OPACITY and the FONT_ / LINE_HEIGHT / ' +
    'LETTER_SPACING / PARAGRAPH_ scopes; STRING takes ALL_SCOPES / TEXT_CONTENT / FONT_FAMILY / ' +
    'FONT_STYLE; BOOLEAN only ALL_SCOPES; EASING and TIMING none. [] offers a COLOR / FLOAT / ' +
    'STRING variable nowhere (how a primitive aliased by semantic tokens is kept out of the ' +
    'pickers); ALL_SCOPES and ALL_FILLS cannot be combined with narrower ones. A call that fails ' +
    'part-way leaves the variable as it was. A library variable is read-only here: edit it in the ' +
    'library file. Values have set_variable_value, code syntax set_variable_code_syntax. Returns ' +
    '{ ok, variableId, name, adjusted? } — adjusted says when Figma stored the description ' +
    'differently from what was sent (it trims surrounding whitespace).',
  inputSchema: z.object({
    variableId: z.string().describe('Variable id'),
    name: z
      .string()
      .optional()
      .describe('New name, e.g. "color/brand" (slashes group it into folders)'),
    description: z.string().optional().describe('The description, as plain text; "" clears it'),
    scopes: variableScopesSchema
      .optional()
      .describe('Where Figma offers the variable, replacing the current list'),
    hiddenFromPublishing: z
      .boolean()
      .optional()
      .describe('true leaves the variable out of the published library'),
  }),
  kind: 'write',
};
