import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const IMPORT_IMAGE_TOOL_NAME = 'import_image';

export const importImageToolDefinition: Tool = {
  name: IMPORT_IMAGE_TOOL_NAME,
  description:
    'Import an image and place it as a rectangle with an IMAGE fill. Provide data (base64-encoded ' +
    'image bytes) or url. The rectangle defaults to the image size unless width/height are given. ' +
    'scaleMode is FILL / FIT / CROP / TILE (default FILL). Returns { ok, nodeId, name, type }.',
  inputSchema: {
    type: 'object',
    properties: {
      data: { type: 'string', description: 'Base64-encoded image bytes (PNG / JPG / GIF)' },
      url: { type: 'string', description: 'Image URL to fetch instead of data' },
      name: { type: 'string', description: 'Optional name for the new rectangle' },
      parentId: { type: 'string', description: 'Parent node id (default: current page)' },
      x: { type: 'number' },
      y: { type: 'number' },
      width: { type: 'number', description: 'Override width (default: image width)' },
      height: { type: 'number', description: 'Override height (default: image height)' },
      scaleMode: { type: 'string', enum: ['FILL', 'FIT', 'CROP', 'TILE'] },
    },
    additionalProperties: false,
  },
};
