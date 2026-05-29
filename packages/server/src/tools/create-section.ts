import { z } from 'zod';

import { specToToolDefinition, type ToolSpec } from './spec.js';

export const CREATE_SECTION_TOOL_NAME = 'create_section';

export const createSectionTool: ToolSpec = {
  name: CREATE_SECTION_TOOL_NAME,
  description:
    'Create a section (a canvas-level grouping container), optionally sized / named / positioned. ' +
    'Sections live on a page or inside another section. Returns { ok, nodeId, name, type }.',
  inputShape: {
    parentId: z.string().optional().describe('Parent node id (default: current page)'),
    name: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
  },
  kind: 'write',
};

export const createSectionToolDefinition = specToToolDefinition(createSectionTool);
