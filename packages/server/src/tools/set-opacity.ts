import { z } from 'zod';

import { specToToolDefinition, type ToolSpec } from './spec.js';

export const SET_OPACITY_TOOL_NAME = 'set_opacity';

export const setOpacityTool: ToolSpec = {
  name: SET_OPACITY_TOOL_NAME,
  description: "Set a node's opacity (0–1). Returns { ok, nodeId }.",
  inputShape: {
    nodeId: z.string().describe('Figma node id'),
    opacity: z.number().min(0).max(1).describe('Opacity 0–1'),
  },
  kind: 'write',
};

export const setOpacityToolDefinition = specToToolDefinition(setOpacityTool);
