import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const FLATTEN_NODES_TOOL_NAME = 'flatten_nodes';

export const flattenNodesTool: ToolSpec = {
  name: FLATTEN_NODES_TOOL_NAME,
  description:
    'Flatten nodes into a single vector layer (Figma’s Flatten, ⌘E): shapes, text and boolean ' +
    'groups are outlined and merged into one path whose points can be edited. Irreversible for ' +
    'the content — text stops being text and a boolean group stops being unpickable — so use it ' +
    'when the artwork is final, e.g. to export an icon as a single path. The nodes must share a ' +
    'parent, and the result takes their place there. Not allowed inside a batch. Returns ' +
    '{ ok, nodeId, name, type }.',
  inputSchema: z.object({
    nodeIds: z.array(z.string()).min(1).describe('Nodes to flatten (one parent)'),
    name: z.string().optional().describe('Name for the resulting vector'),
  }),
  kind: 'write',
};
