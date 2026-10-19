import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const AUDIT_LAYOUT_TOOL_NAME = 'audit_layout';

export const auditLayoutTool: ToolSpec = {
  name: AUDIT_LAYOUT_TOOL_NAME,
  description:
    'Check a built design for measurable layout mistakes, from geometry rather than a screenshot ' +
    '— call it after building or editing, before reporting done. Finds: content clipped by or ' +
    'overflowing its parent (error / warning); a frame still at the default 100×100 although it ' +
    'holds content; a free-placed child within 2px of centred but not centred; sibling edges ' +
    'within 2px of each other but not aligned. Hidden layers are ignored, and an instance is ' +
    'checked where it sits but not inside (fix its main component instead). Each issue names the ' +
    'node, what is wrong, and the tool that usually fixes it. Also reports the font families and ' +
    'sizes in use and how many solid fills are hardcoded rather than bound to a style or ' +
    'variable, both outside instances. `root` is a node id (a page id audits its top-level nodes); omit it to audit the ' +
    'current selection, or the current page when nothing is selected. Capped at 5000 nodes ' +
    '(`truncated` says so). Read-only. Returns { ok, scanned, truncated, summary: { errors, ' +
    'warnings }, issues[], omitted, typography, hardcodedFills }.',
  inputSchema: z.object({
    root: z
      .string()
      .optional()
      .describe('Node or page id to audit; omit for the current selection (or page)'),
    maxIssues: z
      .number()
      .int()
      .min(1)
      .max(200)
      .optional()
      .describe('Most issues to return, most severe first (default 60)'),
  }),
  kind: 'read',
};
