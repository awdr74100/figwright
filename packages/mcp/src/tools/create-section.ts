import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const CREATE_SECTION_TOOL_NAME = 'create_section';

export const createSectionTool: ToolSpec = {
  name: CREATE_SECTION_TOOL_NAME,
  description:
    'Create a section: a canvas-level container for grouping and labelling regions of a page (e.g. ' +
    'flows or screen sets). Sections sit on a page or nest inside another section, but not inside a ' +
    'frame; for a UI container or auto-layout use create_frame instead. Returns ' +
    '{ ok, nodeId, name, type }.',
  inputShape: {
    parentId: z.string().optional().describe('Parent page or section id (default: current page)'),
    name: z.string().optional().describe('Section name'),
    x: z.number().optional().describe('X position in the parent'),
    y: z.number().optional().describe('Y position in the parent'),
    width: z.number().optional().describe('Width in px'),
    height: z.number().optional().describe('Height in px'),
  },
  kind: 'write',
};
