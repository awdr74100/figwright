import { z } from 'zod';

import type { ToolSpec } from './spec.js';

const SIDE = z.enum(['TOP', 'RIGHT', 'BOTTOM', 'LEFT']);

const OFFSET = z
  .union([
    z.object({
      type: z.literal('INNER'),
      relative: z.number().min(-1).max(1).describe('Along the span: -1 to 1, 0 the middle'),
    }),
    z.object({
      type: z.literal('OUTER'),
      fixed: z.number().describe('A fixed distance outside the span, in px'),
    }),
  ])
  .describe('Where the line sits; omit for the middle ({ type: "INNER", relative: 0 })');

const RETURNS =
  'Returns { ok, measurementId, pageId, start, end, offset, freeText? } — the measurement as Figma ' +
  'holds it; Figma keeps no distance on it, it draws it from the nodes.';

export const addMeasurementTool: ToolSpec = {
  name: 'add_measurement',
  description:
    'Draw a Dev Mode measurement: a dimension line from one node edge to another (TOP / RIGHT / ' +
    'BOTTOM / LEFT), or across one node between two opposite sides — how a designer calls out a ' +
    'spacing or a size for whoever builds it. Both sides must be on one axis (LEFT/RIGHT or TOP/' +
    'BOTTOM), and both nodes on one page: it goes on that page without switching the user to it. ' +
    'A group, section or page cannot be measured — measure its children. freeText is shown on the ' +
    'line, kept exactly as sent. Read them back with get_annotations { measurements: true }. ' +
    RETURNS,
  inputSchema: z.object({
    startNodeId: z.string().describe('The node the line starts at'),
    startSide: SIDE.describe('The edge of the start node'),
    endNodeId: z
      .string()
      .describe('The node the line ends at (the same node to measure across it)'),
    endSide: SIDE.describe('The edge of the end node'),
    offset: OFFSET.optional(),
    freeText: z.string().optional().describe('Text shown on the measurement'),
  }),
  kind: 'write',
};

export const updateMeasurementTool: ToolSpec = {
  name: 'update_measurement',
  description:
    'Move a measurement\'s line (offset) or change its text (freeText; "" clears it); either may ' +
    'be omitted. Its ends cannot change — delete it and add another. Finds it on any page. ' +
    RETURNS,
  inputSchema: z.object({
    measurementId: z.string().describe('The measurement, by id (from get_annotations)'),
    offset: OFFSET.optional(),
    freeText: z.string().optional().describe('Text shown on the measurement'),
  }),
  kind: 'write',
};

export const deleteMeasurementTool: ToolSpec = {
  name: 'delete_measurement',
  description:
    'Delete a measurement, on whichever page it is. Returns { ok, measurementId, pageId }.',
  inputSchema: z.object({
    measurementId: z.string().describe('The measurement, by id (from get_annotations)'),
  }),
  kind: 'write',
  destructive: true,
};
