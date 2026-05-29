import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const CREATE_TEXT_TOOL_NAME = 'create_text';

export const createTextTool: ToolSpec = {
  name: CREATE_TEXT_TOOL_NAME,
  description:
    'Create a TEXT node with the given characters (default font loaded automatically), optionally ' +
    'sized/positioned and appended to a parent (else the current page). Returns { ok, nodeId, name, type }.',
  inputShape: {
    characters: z.string().describe('Text content'),
    parentId: z.string().optional().describe('Container node id; omit for current page'),
    x: z.number().optional(),
    y: z.number().optional(),
    fontSize: z.number().optional(),
  },
  kind: 'write',
};
