import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const CREATE_GRID_STYLE_TOOL_NAME = 'create_grid_style';

export const createGridStyleToolDefinition: Tool = {
  name: CREATE_GRID_STYLE_TOOL_NAME,
  description:
    'Create a local layout-grid style. GRID is uniform (sectionSize); ROWS / COLUMNS carry ' +
    'count + gutterSize + alignment. Returns { ok, styleId, name }.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Style name, e.g. "Layout/8pt"' },
      grids: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            pattern: { type: 'string', enum: ['GRID', 'ROWS', 'COLUMNS'] },
            visible: { type: 'boolean' },
            sectionSize: { type: 'number' },
            count: { type: 'number' },
            gutterSize: { type: 'number' },
            alignment: { type: 'string', enum: ['MIN', 'MAX', 'CENTER', 'STRETCH'] },
          },
          required: ['pattern', 'visible'],
        },
      },
      description: { type: 'string' },
    },
    required: ['name', 'grids'],
    additionalProperties: false,
  },
};
