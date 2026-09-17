import { z } from 'zod';

// Shared Zod connector-endpoint schema, reused by create_connector so the three shapes Figma
// accepts for a ConnectorEndpoint — floating, attached-with-magnet, and attached-at-a-relative-
// position — stay in one place rather than drifting between the start and end fields.
//
// Loose validation here on purpose: which combination of fields is actually legal (endpointNodeId
// requires magnet unless position is also given) is enforced in the plugin handler, matching how
// this codebase validates set_arc's "at least one field" rule in the handler rather than the
// schema.

export const connectorMagnetSchema = z.enum([
  'NONE',
  'AUTO',
  'TOP',
  'LEFT',
  'BOTTOM',
  'RIGHT',
  'CENTER',
]);

export const connectorEndpointSchema = z
  .object({
    endpointNodeId: z
      .string()
      .optional()
      .describe('Node id to attach this end to; omit for a floating endpoint at `position`'),
    magnet: connectorMagnetSchema
      .optional()
      .describe(
        "Attachment side when endpointNodeId is given without position (default 'AUTO' — Figma " +
          'picks the nearest side)',
      ),
    position: z
      .object({ x: z.number(), y: z.number() })
      .optional()
      .describe(
        'Either an absolute canvas position (floating endpoint, no endpointNodeId) or a 0–1 ' +
          'position relative to endpointNodeId (e.g. { x: 1, y: 0.5 } = right-middle of that node)',
      ),
  })
  .describe(
    'One connector endpoint: { endpointNodeId, magnet? } to attach with auto/side magnet, ' +
      '{ position } to float, or { endpointNodeId, position } to attach at a relative point',
  );

export const connectorStrokeCapSchema = z.enum([
  'NONE',
  'ARROW_EQUILATERAL',
  'ARROW_LINES',
  'TRIANGLE_FILLED',
  'DIAMOND_FILLED',
  'CIRCLE_FILLED',
  'ERD_ZERO_OR_ONE',
  'ERD_EXACTLY_ONE',
  'ERD_ZERO_OR_MORE',
  'ERD_ONE_OR_MORE',
  'ERD_ONE',
]);

export const connectorLineTypeSchema = z.enum(['ELBOWED', 'STRAIGHT', 'CURVED']);
