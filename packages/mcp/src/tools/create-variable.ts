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
const VARIABLE_SCOPES = [
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

export const createVariableTool: ToolSpec = {
  name: CREATE_VARIABLE_TOOL_NAME,
  // EASING / TIMING are intentionally absent from the enum: Figma's createVariable rejects them
  // outright, so listing them would only steer an agent into a call that cannot succeed. The
  // description still names them so an agent that sees such a variable knows why it can't make one.
  // See the note in the sandbox handler (packages/plugin/src/handlers/create-variable.ts).
  description:
    'Create a variable in a collection with resolvedType BOOLEAN / FLOAT / STRING / COLOR. The ' +
    'variable starts empty — set per-mode values with set_variable_value, then attach it with ' +
    'bind_variable_to_node or bind_variable_to_paint. EASING and TIMING variables cannot be created ' +
    'by plugins at all — Figma rejects it; they can only be made in the Figma UI. Optionally pass ' +
    'scopes to narrow where Figma offers the variable in its picker (a radius token scoped to ' +
    'CORNER_RADIUS stops being suggested for width or gap); omit it to leave the variable in every ' +
    "scope, which is Figma's default. Returns { ok, variableId, name }.",
  inputSchema: z.object({
    name: z.string().describe('Variable name, e.g. "color/primary"'),
    collectionId: z.string().describe('Variable collection id'),
    resolvedType: z.enum(['BOOLEAN', 'FLOAT', 'STRING', 'COLOR']).describe('Variable data type'),
    scopes: z
      .array(z.enum(VARIABLE_SCOPES))
      .nonempty()
      .optional()
      .describe(
        'Where Figma offers this variable in its picker, e.g. ["CORNER_RADIUS"] or ' +
          '["FRAME_FILL","SHAPE_FILL"]. Omit for all scopes.',
      ),
  }),
  kind: 'write',
};
