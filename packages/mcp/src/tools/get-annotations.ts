import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const GET_ANNOTATIONS_TOOL_NAME = 'get_annotations';

export const getAnnotationsTool: ToolSpec = {
  name: GET_ANNOTATIONS_TOOL_NAME,
  description:
    'Return Dev Mode annotations as { annotations: [{ nodeId, nodeName, annotations }], ' +
    "categories }. With nodeId, returns that node's annotations; without it, scans the current " +
    'page for all annotated nodes. A note carries label and labelMarkdown (the same text, plain ' +
    'and formatted); categoryId and properties (the node fields pinned to it) when set, and an ' +
    'annotation may be properties alone. categories ' +
    'lists every category in the file ({ id, label, color, isPreset }), so a categoryId resolves ' +
    'to its label; an id not listed names a category deleted since. With measurements: true it ' +
    "also lists the page's Dev Mode measurements (with nodeId, the ones touching that node), when " +
    'there are any: { id, start: { nodeId, side }, end, offset, freeText? } — Figma keeps no distance on ' +
    "one; it is the gap between those node edges, so read it off the nodes' geometry. Write them " +
    'with set_annotations and add_measurement.',
  inputSchema: z.object({
    measurements: z
      .boolean()
      .optional()
      .describe("Also return the page's (or the node's) Dev Mode measurements"),
    nodeId: z
      .string()
      .describe('Node id to read annotations from; omit to scan the current page')
      .optional(),
  }),
  kind: 'read',
};
