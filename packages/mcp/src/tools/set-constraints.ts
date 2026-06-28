import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const SET_CONSTRAINTS_TOOL_NAME = 'set_constraints';

const constraint = z.enum(['MIN', 'CENTER', 'MAX', 'STRETCH', 'SCALE']);

export const setConstraintsTool: ToolSpec = {
  name: SET_CONSTRAINTS_TOOL_NAME,
  description:
    'Set how a node responds when its parent frame is resized, via horizontal and vertical ' +
    'constraints: MIN pins to the left/top, MAX to the right/bottom, CENTER keeps it centered, ' +
    'STRETCH pins both edges (grows with the parent), and SCALE resizes proportionally. Constraints ' +
    'apply inside plain frames only — auto-layout frames position children by layout rules and ' +
    'ignore them. Returns { ok, nodeId }.',
  inputShape: {
    nodeId: z.string().describe('Node to constrain'),
    horizontal: constraint.describe('Horizontal behavior when the parent resizes'),
    vertical: constraint.describe('Vertical behavior when the parent resizes'),
  },
  kind: 'write',
};
