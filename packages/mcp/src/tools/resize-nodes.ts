import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const RESIZE_NODES_TOOL_NAME = 'resize_nodes';

export const resizeNodesTool: ToolSpec = {
  name: RESIZE_NODES_TOOL_NAME,
  description:
    'Resize nodes to the given width × height (width at least 0.01 px). A LINE takes the width as ' +
    'its length and keeps height 0 — pass 0, or any height is reported in adjusted; every other ' +
    'node needs a height of at least 0.01 px, checked before any node is resized. ' +
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
    height: z
      .number()
      .min(0)
      .describe(
        'At least 0.01 px; a LINE keeps height 0 whatever is passed (0 is exact for a line)',
      ),
  }),
  kind: 'write',
};
