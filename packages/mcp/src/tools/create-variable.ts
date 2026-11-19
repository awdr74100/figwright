import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const CREATE_VARIABLE_TOOL_NAME = 'create_variable';

// Figma's VariableScope as of plugin-typings 1.139 (COLOR_OPACITY is that release's addition).
//
// An enum here, while get_variable_defs reports scopes back as plain strings, is deliberate and the
// asymmetry is the point: on the way in the agent has to pick a name it cannot guess (FRAME_FILL vs
// SHAPE_FILL vs ALL_FILLS), and a wrong one is a silent no-op in the picker, so listing them is
// worth the cost of this list going stale — a scope a future release adds simply can't be set until
// the list is updated, which is a loud gap, not a silent one. On the way out the opposite holds:
// a narrow enum would reject a value Figma really returned.
export const VARIABLE_SCOPES = [
  'ALL_SCOPES',
  'TEXT_CONTENT',
  'CORNER_RADIUS',
  'WIDTH_HEIGHT',
  'GAP',
  'ALL_FILLS',
  'FRAME_FILL',
  'SHAPE_FILL',
  'TEXT_FILL',
  'STROKE_COLOR',
  'STROKE_FLOAT',
  'EFFECT_FLOAT',
  'EFFECT_COLOR',
  'OPACITY',
  'COLOR_OPACITY',
  'FONT_FAMILY',
  'FONT_STYLE',
  'FONT_WEIGHT',
  'FONT_SIZE',
  'LINE_HEIGHT',
  'LETTER_SPACING',
  'PARAGRAPH_SPACING',
  'PARAGRAPH_INDENT',
] as const;

/**
 * The scopes a variable may be offered in. Which of them a type takes is Figma's to say — its
 * refusal is passed on with the accepted list (variable-fields.ts) — so this checks names only.
 */
export const variableScopesSchema = z.array(z.enum(VARIABLE_SCOPES));

export const createVariableTool: ToolSpec = {
  name: CREATE_VARIABLE_TOOL_NAME,
  description:
    'Create a variable in a collection with resolvedType BOOLEAN / FLOAT / STRING / COLOR / EASING ' +
    '/ TIMING. Set per-mode values with set_variable_value, then attach it with ' +
    'bind_variable_to_node or bind_variable_to_paint — or, for EASING (a Motion curve) and TIMING ' +
    '(seconds), as a { type: "VARIABLE_ALIAS", id } in a Motion easing or a preset\'s delay / ' +
    'duration. Optionally pass ' +
    'scopes to narrow where Figma offers the variable in its picker (a radius token scoped to ' +
    'CORNER_RADIUS stops being suggested for width or gap; [] offers it nowhere, the usual way to ' +
    'keep a primitive that semantic tokens alias out of the pickers); omit it to leave the variable ' +
    "in every scope, which is Figma's default. description and hiddenFromPublishing may be set " +
    'too. Returns { ok, variableId, name, adjusted? } — adjusted says when Figma stored the ' +
    'description differently from what was sent (it trims surrounding whitespace).',
  inputSchema: z.object({
    name: z.string().describe('Variable name, e.g. "color/primary"'),
    collectionId: z.string().describe('Variable collection id'),
    resolvedType: z
      .enum(['BOOLEAN', 'FLOAT', 'STRING', 'COLOR', 'EASING', 'TIMING'])
      .describe('Variable data type'),
    scopes: variableScopesSchema
      .optional()
      .describe(
        'Where Figma offers this variable in its picker, e.g. ["CORNER_RADIUS"] or ' +
          '["FRAME_FILL","SHAPE_FILL"]; [] for nowhere (not BOOLEAN). Omit for all scopes. Not ' +
          'available for EASING / TIMING.',
      ),
    description: z.string().optional().describe("The variable's description, as plain text"),
    hiddenFromPublishing: z
      .boolean()
      .optional()
      .describe('true leaves the variable out of the published library'),
  }),
  kind: 'write',
};
