import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const GET_NODES_INFO_TOOL_NAME = 'get_nodes_info';

export const getNodesInfoTool: ToolSpec = {
  name: GET_NODES_INFO_TOOL_NAME,
  description:
    'Return multiple Figma nodes by id. Output preserves input order; missing ids slot null.',
  inputSchema: z.object({ nodeIds: z.array(z.string()).describe('Figma node ids to fetch') }),
  kind: 'read',
};
