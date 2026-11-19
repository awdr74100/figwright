import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const GET_ANNOTATIONS_TOOL_NAME = 'get_annotations';

export const getAnnotationsTool: ToolSpec = {
  name: GET_ANNOTATIONS_TOOL_NAME,
  description:
    'Return Dev Mode annotations as { annotations: [{ nodeId, nodeName, annotations }], ' +
    "categories }. With nodeId, returns that node's annotations; without it, scans the current " +
    'page for all annotated nodes. Each annotation carries label and labelMarkdown (the same note, ' +
    'plain and formatted), categoryId and properties (the node fields pinned to it). categories ' +
    'lists every category in the file ({ id, label, color, isPreset }), so a categoryId resolves ' +
    'to its label; an id not listed names a category deleted since. Write them with ' +
    'set_annotations.',
  inputSchema: z.object({
    nodeId: z
      .string()
      .describe('Node id to read annotations from; omit to scan the current page')
      .optional(),
  }),
  kind: 'read',
};
