import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const CREATE_COMPONENT_TOOL_NAME = 'create_component';

export const createComponentTool: ToolSpec = {
  name: CREATE_COMPONENT_TOOL_NAME,
  description:
    'Create a reusable main component. Pass fromNodeId to convert an existing node into a component ' +
    "(e.g. a frame of vectors from import_svg, or a built layout) — it keeps the node's position and " +
    'parent unless parentId is given; omit fromNodeId to create an empty component to build into. ' +
    'Then create_instance the result to reuse it. Optionally sized / named / positioned and placed ' +
    'under a parent (default: current page). Returns { ok, nodeId, name, type }.',
  inputShape: {
    fromNodeId: z
      .string()
      .optional()
      .describe('Convert this existing node into a component (default: create an empty component)'),
    parentId: z.string().optional().describe('Parent node id (default: current page)'),
    name: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
  },
  kind: 'write',
};
