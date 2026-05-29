import { z } from 'zod';

import { specToToolDefinition, type ToolSpec } from './spec.js';

export const DETACH_INSTANCE_TOOL_NAME = 'detach_instance';

export const detachInstanceTool: ToolSpec = {
  name: DETACH_INSTANCE_TOOL_NAME,
  description:
    'Detach an instance into a plain frame (breaks the component link). ' +
    'Returns { ok, nodeId, name, type } for the resulting frame.',
  inputShape: {
    instanceId: z.string().describe('Instance node id to detach'),
  },
  kind: 'write',
};

export const detachInstanceToolDefinition = specToToolDefinition(detachInstanceTool);
