import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const RESIZE_NODES_TOOL_NAME = 'resize_nodes';

export const resizeNodesTool: ToolSpec = {
  name: RESIZE_NODES_TOOL_NAME,
  description:
    'Resize nodes to the given width × height (at least 0.01 px; LINE nodes require height 0). ' +
    'Invalid dimensions for any resizable target are rejected before any node is resized. ' +
    'This fixes the size, so an auto-layout ' +
    'FILL / HUG axis becomes FIXED. Non-resizable nodes are skipped. A layer inside an instance keeps ' +
    'the size its main component gives it — resize the instance itself, change the layer in the main ' +
    'component, or detach_instance first. Every node is read back: affected lists the nodes that ' +
    'reached the requested size, and adjusted lists any Figma sized differently (an instance layer, a ' +
    'minWidth / maxWidth / minHeight / maxHeight bound) with its actual size and why. A call that ' +
    'changed nothing throws. Returns { ok, affected, adjusted? }.',
  inputSchema: z.object({
    nodeIds: z.array(z.string()).describe('Node ids to resize'),
    width: z.number().min(0.01),
    height: z.number().min(0).describe('0 for LINE nodes; at least 0.01 px for other nodes'),
  }),
  kind: 'write',
};
