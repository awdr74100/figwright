import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const CREATE_SECTION_TOOL_NAME = 'create_section';

export const createSectionToolDefinition: Tool = {
  name: CREATE_SECTION_TOOL_NAME,
  description:
    'Create a section (a canvas-level grouping container), optionally sized / named / positioned. ' +
    'Sections live on a page or inside another section. Returns { ok, nodeId, name, type }.',
  inputSchema: {
    type: 'object',
    properties: {
      parentId: { type: 'string', description: 'Parent node id (default: current page)' },
      name: { type: 'string' },
      x: { type: 'number' },
      y: { type: 'number' },
      width: { type: 'number' },
      height: { type: 'number' },
    },
    additionalProperties: false,
  },
};
