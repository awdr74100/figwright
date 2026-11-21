import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const SET_TEXT_TOOL_NAME = 'set_text';

export const setTextTool: ToolSpec = {
  name: SET_TEXT_TOOL_NAME,
  description:
    'Replace the entire text content of a TEXT node, of text on a path (TEXT_PATH), or of a FigJam ' +
    'STICKY, SHAPE_WITH_TEXT, TABLE_CELL or CONNECTOR — whose words live in a sublayer no tool can ' +
    "address, so pass the container's own id; the plugin loads the node's current fonts " +
    'first. Styled runs the old and new text share whole at the start or end keep their styling, ' +
    'so a typo fix leaves a bold word or a link alone; the rewritten span takes the style of the ' +
    'text it replaces. For formatting (font, size, ' +
    'color, spacing) use set_text_properties, and to substitute text across many nodes use ' +
    'find_replace_text (neither reaches a FigJam caption). Returns { ok, nodeId }.',
  inputSchema: z.object({
    nodeId: z
      .string()
      .describe(
        'TEXT / TEXT_PATH node id, or a FigJam STICKY / SHAPE_WITH_TEXT / TABLE_CELL / CONNECTOR id',
      ),
    characters: z.string().describe('New text content'),
  }),
  kind: 'write',
};
