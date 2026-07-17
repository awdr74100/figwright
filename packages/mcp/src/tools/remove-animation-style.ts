import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const REMOVE_ANIMATION_STYLE_TOOL_NAME = 'remove_animation_style';

export const removeAnimationStyleTool: ToolSpec = {
  name: REMOVE_ANIMATION_STYLE_TOOL_NAME,
  description:
    'Remove an applied Figma Motion animation style from a node. Pass animationStyleId (the ' +
    'appliedStyleId returned by apply_animation_style, or read from get_node_motion) to remove one; ' +
    'omit it to remove all applied styles on the node. Returns { ok, nodeId }.',
  inputShape: {
    nodeId: z.string().describe('Figma node id to remove animation style(s) from'),
    animationStyleId: z
      .string()
      .describe('The applied-style instance id to remove; omit to remove all on the node')
      .optional(),
  },
  kind: 'write',
  destructive: true,
};
