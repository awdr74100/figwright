import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const RESIZE_NODES_TOOL_NAME = 'resize_nodes';

export const resizeNodesTool: ToolSpec = {
  name: RESIZE_NODES_TOOL_NAME,
  description:
    'Resize nodes to the given width × height (positive). Non-resizable nodes are skipped. Returns { ok, affected }.',
  inputShape: {
    nodeIds: z.array(z.string()).describe('Node ids to resize'),
    width: z.number().gt(0),
    height: z.number().gt(0),
  },
  kind: 'write',
};
