import { z } from 'zod';

import { specToToolDefinition, type ToolSpec } from './spec.js';

export const SCAN_TEXT_NODES_TOOL_NAME = 'scan_text_nodes';

export const scanTextNodesTool: ToolSpec = {
  name: SCAN_TEXT_NODES_TOOL_NAME,
  description:
    'Return every TEXT node within a subtree, each with its characters / fontSize / fontName. ' +
    'Scope with root (a node id); defaults to the current page.',
  inputShape: {
    root: z.string().describe('Node id to scope the scan; omit for the current page').optional(),
  },
  kind: 'read',
};

export const scanTextNodesToolDefinition = specToToolDefinition(scanTextNodesTool);
