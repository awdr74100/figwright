import { z } from 'zod';

import { specToToolDefinition, type ToolSpec } from './spec.js';

export const SWAP_COMPONENT_TOOL_NAME = 'swap_component';

export const swapComponentTool: ToolSpec = {
  name: SWAP_COMPONENT_TOOL_NAME,
  description:
    "Swap an instance's main component. Provide componentKey (published component, imported via the " +
    'API) or componentId (a local COMPONENT node). Returns { ok, nodeId } (the instance id).',
  inputShape: {
    instanceId: z.string().describe('Instance node id to swap'),
    componentId: z.string().optional().describe('Local component node id'),
    componentKey: z.string().optional().describe('Published component key'),
  },
  kind: 'write',
};

export const swapComponentToolDefinition = specToToolDefinition(swapComponentTool);
