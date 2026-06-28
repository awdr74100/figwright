import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const DETACH_INSTANCE_TOOL_NAME = 'detach_instance';

export const detachInstanceTool: ToolSpec = {
  name: DETACH_INSTANCE_TOOL_NAME,
  description:
    'Detach a component instance into a plain frame, permanently breaking its link to the main ' +
    'component; the frame keeps its current appearance and its layers become directly editable. To ' +
    'switch an instance to a different component instead of detaching, use swap_component. Returns ' +
    '{ ok, nodeId, name, type } for the resulting frame.',
  inputShape: {
    instanceId: z.string().describe('Instance node id to detach'),
  },
  kind: 'write',
};
