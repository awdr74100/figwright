import { z } from 'zod';

import { keyframeFieldSchema } from './motion-schemas.js';
import type { ToolSpec } from './spec.js';

export const REMOVE_MANUAL_KEYFRAME_TRACK_TOOL_NAME = 'remove_manual_keyframe_track';

export const removeManualKeyframeTrackTool: ToolSpec = {
  name: REMOVE_MANUAL_KEYFRAME_TRACK_TOOL_NAME,
  description:
    'Remove the manual Figma Motion keyframe track for a given field on a node. `field` selects the ' +
    'same target as apply_manual_keyframe_track (a node PROPERTY or an indexed fills/strokes/effects ' +
    'item). Returns { ok, nodeId }.',
  inputShape: {
    nodeId: z.string().describe('Figma node id to clear a keyframe track from'),
    field: keyframeFieldSchema,
  },
  kind: 'write',
  destructive: true,
};
