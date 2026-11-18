import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const GET_LOCAL_COMPONENTS_TOOL_NAME = 'get_local_components';

export const getLocalComponentsTool: ToolSpec = {
  name: GET_LOCAL_COMPONENTS_TOOL_NAME,
  description:
    'Return the components and component sets within a node subtree (or the current selection) as ' +
    '{ components, componentSets }. Scans a subtree, not the whole document — pass nodeId, or select ' +
    'the frames to scan. A document root is not supported; use get_pages and scan each page by nodeId. ' +
    'Components carry their variantProperties (when part of a set); component sets ' +
    'carry their variantGroupProperties (available values per axis) and the ids of their variant components. ' +
    'A set Figma flags with errors (two variants with the same values, or variants whose properties ' +
    'differ) carries componentSetError in place of those properties, and so do its variants. ' +
    'Each carries its plain description. With documentation: true, each also carries ' +
    'descriptionMarkdown when that text has what plain text would lose (bold, links, lists, or the ' +
    'paragraph breaks of a description typed in Figma, which its plain text spells as three ' +
    'newlines), ' +
    'and documentationLinks when it has a link — ask for it before rewriting descriptions; it ' +
    'costs about 0.2 ms per component, so leave it off for a plain inventory.',
  inputSchema: z.object({
    nodeId: z
      .string()
      .describe('Root node id to scan within; omit to use the current selection')
      .optional(),
    documentation: z
      .boolean()
      .optional()
      .describe(
        'Also return descriptionMarkdown (when it has formatting) and documentationLinks for each',
      ),
  }),
  kind: 'read',
};
