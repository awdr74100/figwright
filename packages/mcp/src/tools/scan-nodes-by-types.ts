import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const SCAN_NODES_BY_TYPES_TOOL_NAME = 'scan_nodes_by_types';

export const scanNodesByTypesTool: ToolSpec = {
  name: SCAN_NODES_BY_TYPES_TOOL_NAME,
  description:
    'Return a flat list of every node whose type is in `types`, searched recursively through a ' +
    'subtree scoped by `root` (a node id) or the current page by default. Use this to collect nodes ' +
    'by kind (e.g. all TEXT or COMPONENT nodes); to search by name or characters use search_nodes, ' +
    'and for a styled tree snapshot use get_design_context. Returns a flat array of matching nodes.',
  inputShape: {
    types: z.array(z.string()).describe('Node types to match, e.g. ["FRAME", "COMPONENT"]'),
    root: z.string().describe('Node id to scope the scan; omit for the current page').optional(),
  },
  kind: 'read',
};
