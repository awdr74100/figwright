import { DETAIL_LEVELS } from '@figma-mcp-relay/shared';
import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const GET_DESIGN_CONTEXT_TOOL_NAME = 'get_design_context';

export const getDesignContextTool: ToolSpec = {
  name: GET_DESIGN_CONTEXT_TOOL_NAME,
  description:
    'Get a depth-limited, token-efficient node tree for exploring large files — prefer this over ' +
    'get_document. Starts from nodeId, else the current selection, else the current page. ' +
    'depth limits child levels (omit or 0 = unlimited). detail is minimal / compact / full. ' +
    'dedupeComponents collapses repeated component instances (children of an already-seen main ' +
    'component are omitted and flagged deduped). A deduped instance still carries textOverrides — ' +
    'the visible text it renders ({ name, characters }) — so per-instance content (card titles, ' +
    'list items, form labels) is available without re-expanding the collapsed subtree.',
  inputShape: {
    nodeId: z
      .string()
      .describe('Root node id; omit to use the selection or current page')
      .optional(),
    depth: z
      .number()
      .min(0)
      .describe('Max child levels to include; omit or 0 for unlimited')
      .optional(),
    detail: z
      .enum(DETAIL_LEVELS)
      .describe('How much per-node data: minimal / compact (default) / full')
      .optional(),
    dedupeComponents: z
      .boolean()
      .describe('Collapse repeated instances of the same main component')
      .optional(),
  },
  kind: 'read',
};
