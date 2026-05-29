import { z } from 'zod';

import { specToToolDefinition, type ToolSpec } from './spec.js';

export const SET_TEXT_PROPERTIES_TOOL_NAME = 'set_text_properties';

export const setTextPropertiesTool: ToolSpec = {
  name: SET_TEXT_PROPERTIES_TOOL_NAME,
  description:
    "Set a TEXT node's layout/overflow properties: textTruncation (ellipsis), maxLines (line clamp), " +
    'textAutoResize. Any field may be omitted to leave it unchanged. maxLines applies when ' +
    'textTruncation is ENDING. Returns { ok, nodeId }.',
  inputShape: {
    nodeId: z.string().describe('TEXT node id'),
    textTruncation: z
      .enum(['DISABLED', 'ENDING'])
      .optional()
      .describe('ENDING truncates with an ellipsis'),
    maxLines: z
      .number()
      .nullable()
      .optional()
      .describe('Max lines before truncation; null = unlimited'),
    textAutoResize: z
      .enum(['NONE', 'HEIGHT', 'WIDTH_AND_HEIGHT', 'TRUNCATE'])
      .optional()
      .describe('How the text box resizes to its content'),
  },
  kind: 'write',
};

export const setTextPropertiesToolDefinition = specToToolDefinition(setTextPropertiesTool);
