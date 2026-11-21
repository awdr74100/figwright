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
    'Join two FigJam nodes with a connector (the arrow or line of a flowchart), or draw one between ' +
    'free points. connectorStart / connectorEnd each take { endpointNodeId, magnet? } to attach to a ' +
    "side of a node (magnet TOP / BOTTOM / LEFT / RIGHT / CENTER, default 'AUTO': the nearest), " +
    '{ endpointNodeId, position } to attach at a point on it — px from its top-left, so its ' +
    'right-middle is { x: width, y: height / 2 } — or { position } to float, in px in the ' +
    "parent's coordinates. An attached end follows its node when it moves, and removing the node " +
    'removes the connector with it. Defaults as in FigJam: ELBOWED, no start cap, an ARROW_LINES ' +
    'end, weight 4. text labels it in FigJam’s caption face (Inter Medium) and names the layer ' +
    'after it; set_text rewrites it later. FigJam only: Figma Design and Dev Mode have no ' +
    'connectors. Returns { ok, nodeId, name, type }.',
  inputSchema: z.object({
    connectorStart: connectorEndpointSchema,
    connectorEnd: connectorEndpointSchema,
    parentId: z.string().optional().describe('Parent node id (default: current page)'),
    name: z.string().optional().describe('Layer name'),
    connectorLineType: connectorLineTypeSchema
      .optional()
      .describe("Path shape (default 'ELBOWED': right-angle bends)"),
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
      .describe('Label on the connector, written in FigJam’s caption face'),
  }),
  kind: 'write',
};
