import { z } from 'zod';

import { specToToolDefinition, type ToolSpec } from './spec.js';

export const ROTATE_NODES_TOOL_NAME = 'rotate_nodes';

export const rotateNodesTool: ToolSpec = {
  name: ROTATE_NODES_TOOL_NAME,
  description:
    'Set absolute rotation (degrees) on nodes. Nodes without rotation are skipped. Returns { ok, affected }.',
  inputShape: {
    nodeIds: z.array(z.string()).describe('Node ids to rotate'),
    rotation: z.number().describe('Rotation in degrees'),
  },
  kind: 'write',
};

export const rotateNodesToolDefinition = specToToolDefinition(rotateNodesTool);
