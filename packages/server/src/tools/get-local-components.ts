import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const GET_LOCAL_COMPONENTS_TOOL_NAME = 'get_local_components';

export const getLocalComponentsTool: ToolSpec = {
  name: GET_LOCAL_COMPONENTS_TOOL_NAME,
  description:
    'Return the components and component sets within a node subtree (or the current selection) as ' +
    '{ components, componentSets }. Scans a subtree, not the whole document — pass nodeId, or select ' +
    'the frames to scan. Components carry their variantProperties (when part of a set); component sets ' +
    'carry their variantGroupProperties (available values per axis) and the ids of their variant components.',
  inputShape: {
    nodeId: z
      .string()
      .describe('Root node id to scan within; omit to use the current selection')
      .optional(),
  },
  kind: 'read',
};
