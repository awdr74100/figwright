import { z } from 'zod';

import { specToToolDefinition, type ToolSpec } from './spec.js';

export const DELETE_STYLE_TOOL_NAME = 'delete_style';

export const deleteStyleTool: ToolSpec = {
  name: DELETE_STYLE_TOOL_NAME,
  description:
    'Delete a local style (paint / text / effect / grid) by id. Returns { ok, styleId, name }.',
  inputShape: {
    styleId: z.string().describe('Style id to delete'),
  },
  kind: 'write',
};

export const deleteStyleToolDefinition = specToToolDefinition(deleteStyleTool);
