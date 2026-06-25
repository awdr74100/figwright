import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const SET_ARC_TOOL_NAME = 'set_arc';

export const setArcTool: ToolSpec = {
  name: SET_ARC_TOOL_NAME,
  description:
    'Turn an ellipse into a pie slice / gauge or a ring / donut by setting its arc data. ' +
    'startingAngle / endingAngle are in radians and carve out the visible wedge (a full circle is ' +
    '0 → 2π ≈ 6.28319; a half is π ≈ 3.14159); innerRadius is 0–1 of the radius (0 = a solid disc, ' +
    '> 0 = a ring with a hole, e.g. 0.6 for a donut or progress ring). Only ellipses have arc data. ' +
    'Pass any subset — omitted fields keep their current value. At least one is required. Returns ' +
    '{ ok, nodeId }.',
  inputShape: {
    nodeId: z.string().describe('Figma node id (must be an ellipse)'),
    startingAngle: z.number().optional().describe('Arc start angle in radians'),
    endingAngle: z.number().optional().describe('Arc end angle in radians'),
    innerRadius: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe('Inner radius 0–1 of the outer radius (0 = solid disc, > 0 = ring / donut)'),
  },
  kind: 'write',
};
