import { z } from 'zod';

import { specToToolDefinition, type ToolSpec } from './spec.js';

export const CREATE_FRAME_TOOL_NAME = 'create_frame';

export const createFrameTool: ToolSpec = {
  name: CREATE_FRAME_TOOL_NAME,
  description:
    'Create a frame, optionally sized/positioned and appended to a parent (else the current page). ' +
    'Returns { ok, nodeId, name, type }.',
  inputShape: {
    parentId: z
      .string()
      .optional()
      .describe('Container node id to append into; omit for current page'),
    name: z.string().optional().describe('Frame name'),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().optional().describe('Frame width (with height, resizes from default)'),
    height: z.number().optional().describe('Frame height (with width, resizes from default)'),
  },
  kind: 'write',
};

export const createFrameToolDefinition = specToToolDefinition(createFrameTool);
