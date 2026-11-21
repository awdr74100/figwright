import { z } from 'zod';

// Shared Zod connector-endpoint schema, reused by create_connector so the three shapes Figma
// accepts for a ConnectorEndpoint — floating, attached-with-magnet, and attached-at-a-relative-
// position — stay in one place rather than drifting between the start and end fields.
//
// Loose validation here on purpose: which combination of fields is legal (a magnet goes with a bare
// endpointNodeId, a position with or without one) is enforced in the plugin handler, as set_arc's
// "at least one field" rule is.

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
        "The side it attaches to, with endpointNodeId and no position (default 'AUTO': Figma " +
          'picks the nearest side)',
      ),
    position: z
      .object({ x: z.number(), y: z.number() })
      .optional()
      .describe(
        'With endpointNodeId: px from that node’s top-left (its right-middle is { x: width, y: ' +
          'height / 2 }; outside it is allowed). Alone: a floating end, in px in the parent’s ' +
          'coordinates (the page’s by default), so it moves with the parent',
      ),
  })
  .describe(
    'One connector end: { endpointNodeId, magnet? } attached to a side of a node, ' +
      '{ endpointNodeId, position } attached at a point on it, or { position } floating',
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
  'ERD_MANY',
]);

export const connectorLineTypeSchema = z.enum(['ELBOWED', 'STRAIGHT', 'CURVED']);
