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
    'detail: minimal (id/name/type) / compact (+ geometry) / full (+ styling, layout, text and ' +
    'design-system tokens resolved to names plus a deduped globalVars style table). Defaults to ' +
    'full with dedupeComponents true — the code-generation view; pass detail: compact explicitly ' +
    'for a cheap structure scan. An over-budget full result degrades gracefully: first to the ' +
    'compact structure of the same tree (note attached), then to a sectionPlan. ' +
    'depth limits child levels (omit or 0 = unlimited; cut nodes are ' +
    'flagged truncated). dedupeComponents collapses repeated instances of an already-expanded main ' +
    'component (flagged deduped); a deduped instance still carries textOverrides ({ name, ' +
    'characters } — the visible text it actually renders) and propertyOverrides (its per-instance ' +
    'visual diffs), so per-instance content survives without re-expanding the collapsed subtree. ' +
    'A tree too large to return whole comes back as a sectionPlan instead ({ sections: [{ nodeId, ' +
    'name, nodes, … }] } + a note): do not retry unscoped — call again per section nodeId at ' +
    'detail full and build section by section. On a full result, raw color values that exactly ' +
    "equal a project design token are annotated in projectTokens ({ '#6266F0': { ref, name, " +
    "matchedBy: ['value'] } }, or { matchedBy, candidates: [...] } when several tokens share the " +
    'value). An entry carrying `from` is a SCSS variable whose ref does NOT resolve on its own — ' +
    'the file you write must @use it first, and `from` is REPO-relative while Sass resolves @use ' +
    'against the importing file, so re-resolve it from where you are writing ' +
    "(src/components/x.scss imports '../styles/tokens'). `as *` keeps the ref as given, a " +
    'namespaced @use requires prefixing it; emitting the ref without the import is a compile error. ' +
    "matchedBy: ['value'] marks every entry as name-blind value-equality evidence — a " +
    'hypothesis to verify, not a resolved binding: emit the ref only when the token fits the ' +
    'context semantically, keep the raw value otherwise, and let a bound Figma variable win over ' +
    'a raw-value match.',
  inputSchema: z.object({
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
      .describe('How much per-node data: minimal / compact / full (default)')
      .optional(),
    dedupeComponents: z
      .boolean()
      .describe('Collapse repeated instances of the same main component (default true)')
      .optional(),
  }),
  kind: 'read',
  // See index.ts: the guarded public path dispatches with budget so the plugin bails before
  // serializing an oversized tree. Internal dispatches (design_diff, component/icon map) stay raw.
  injectedArgs: ['budget'],
};
