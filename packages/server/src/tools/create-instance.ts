import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const CREATE_INSTANCE_TOOL_NAME = 'create_instance';

export const createInstanceTool: ToolSpec = {
  name: CREATE_INSTANCE_TOOL_NAME,
  description:
    'Instantiate a component. Provide componentId (a local COMPONENT node) or componentKey (a ' +
    'published component imported via the API). Optionally name / position / parent the instance. ' +
    'Returns { ok, nodeId, name, type } for the new instance.',
  inputShape: {
    componentId: z.string().optional().describe('Local component node id to instantiate'),
    componentKey: z.string().optional().describe('Published component key to instantiate'),
    parentId: z.string().optional().describe('Container node id; omit for current page'),
    name: z.string().optional().describe('Optional name for the new instance'),
    x: z.number().optional(),
    y: z.number().optional(),
  },
  kind: 'write',
};
