import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const GET_ANNOTATIONS_TOOL_NAME = 'get_annotations';

export const getAnnotationsTool: ToolSpec = {
  name: GET_ANNOTATIONS_TOOL_NAME,
  description:
    'Return Dev Mode annotations as { annotations: [{ nodeId, nodeName, annotations }] }. ' +
    "With nodeId, returns that node's annotations; without it, scans the current page for all " +
    'annotated nodes.',
  inputShape: {
    nodeId: z
      .string()
      .describe('Node id to read annotations from; omit to scan the current page')
      .optional(),
  },
  kind: 'read',
};
