import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const COMBINE_AS_VARIANTS_TOOL_NAME = 'combine_as_variants';

export const combineAsVariantsTool: ToolSpec = {
  name: COMBINE_AS_VARIANTS_TOOL_NAME,
  description:
    'Combine two or more existing COMPONENT nodes into a single COMPONENT_SET (a variant set). ' +
    'Name each component with Figma variant syntax (e.g. "Size=Small", "Size=Large") beforehand so ' +
    'the set derives its properties. The components are reparented into the new set under parentId ' +
    "(default: the first component's current parent). Returns { ok, nodeId, name, type }.",
  inputShape: {
    nodeIds: z
      .array(z.string())
      .min(2)
      .describe('Component node ids to combine (all must be COMPONENT nodes; at least 2)'),
    parentId: z
      .string()
      .optional()
      .describe("Parent to place the set under (default: the first component's parent)"),
    name: z.string().optional().describe('Optional name for the resulting component set'),
  },
  kind: 'write',
};
