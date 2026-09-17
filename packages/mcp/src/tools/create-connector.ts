import { z } from 'zod';

import {
  connectorEndpointSchema,
  connectorLineTypeSchema,
  connectorStrokeCapSchema,
} from './connector-schema.js';
import { paintItemSchema } from './paint-schema.js';
import type { ToolSpec } from './spec.js';

export const CREATE_CONNECTOR_TOOL_NAME = 'create_connector';

export const createConnectorTool: ToolSpec = {
  name: CREATE_CONNECTOR_TOOL_NAME,
  description:
    'Create a FigJam connector (arrow/line) joining two nodes, or floating at explicit canvas ' +
    'positions. connectorStart / connectorEnd each take { endpointNodeId, magnet? } to attach with ' +
    "magnet (default 'AUTO'), { position } to float, or { endpointNodeId, position } to attach at a " +
    "0–1 relative point (e.g. { x: 1, y: 0.5 } = right-middle). Only FigJam ('figjam' editorType) " +
    'supports connectors — this fails in Figma Design and Dev Mode files. Optionally styled ' +
    '(connectorLineType, stroke caps, strokes, strokeWeight) and labeled (text, using the default ' +
    'font). Appended to a parent (default: current page). Returns { ok, nodeId, name, type }.',
  inputSchema: z.object({
    connectorStart: connectorEndpointSchema,
    connectorEnd: connectorEndpointSchema,
    parentId: z.string().optional().describe('Parent node id (default: current page)'),
    name: z.string().optional().describe('Layer name'),
    connectorLineType: connectorLineTypeSchema
      .optional()
      .describe("Path shape (default 'ELBOWED' — right-angle bends)"),
    connectorStartStrokeCap: connectorStrokeCapSchema
      .optional()
      .describe("Arrowhead at the start (default 'NONE')"),
    connectorEndStrokeCap: connectorStrokeCapSchema
      .optional()
      .describe("Arrowhead at the end (default 'ARROW_LINES')"),
    strokes: z
      .array(paintItemSchema)
      .optional()
      .describe('Line color(s); same shape as set_strokes'),
    strokeWeight: z.number().min(0).optional().describe('Line thickness in px'),
    text: z
      .string()
      .optional()
      .describe(
        'Visible label on the connector (sets connector.text.characters with the default font ' +
          'loaded first — a fresh connector has no valid font until text is written)',
      ),
  }),
  kind: 'write',
};
