import { DETAIL_LEVELS } from '@figwright/shared';
import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const GET_DESIGN_CONTEXT_TOOL_NAME = 'get_design_context';

export const getDesignContextTool: ToolSpec = {
  name: GET_DESIGN_CONTEXT_TOOL_NAME,
  description:
    'Get a depth-limited, token-efficient node tree — the main design-grounding read; prefer it ' +
    'over get_document / get_node for anything large. Starts from nodeId (a pasted Figma URL also ' +
    'works), else the current selection; errors when neither is available. ' +
    'detail: minimal (id/name/type) / compact (+ geometry; the default) / full — only full carries ' +
    'styling, layout, text and design-system tokens resolved to names plus a deduped globalVars ' +
    'style table, so always use full (with dedupeComponents: true) when generating code; compact ' +
    'is for cheap structure scans. depth limits child levels (omit or 0 = unlimited; cut nodes are ' +
    'flagged truncated). dedupeComponents collapses repeated instances of an already-expanded main ' +
    'component (flagged deduped); a deduped instance still carries textOverrides ({ name, ' +
    'characters } — the visible text it actually renders) and propertyOverrides (its per-instance ' +
    'visual diffs), so per-instance content survives without re-expanding the collapsed subtree.',
  inputShape: {
    nodeId: z
      .string()
      .describe('Root node id (a pasted Figma URL also works); omit to use the selection')
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
