import { z } from 'zod';

import { specToToolDefinition, type ToolSpec } from './spec.js';

export const APPLY_STYLE_TO_NODE_TOOL_NAME = 'apply_style_to_node';

export const applyStyleToNodeTool: ToolSpec = {
  name: APPLY_STYLE_TO_NODE_TOOL_NAME,
  description:
    'Bind a shared style to a node. `field` selects which slot the style applies to: fill / ' +
    'stroke / effect / grid / text. Returns { ok, nodeId }.',
  inputShape: {
    nodeId: z.string().describe('Node to apply the style to'),
    styleId: z.string().describe('Style id to bind'),
    field: z.enum(['fill', 'stroke', 'effect', 'grid', 'text']),
  },
  kind: 'write',
};

export const applyStyleToNodeToolDefinition = specToToolDefinition(applyStyleToNodeTool);
