import { z } from 'zod';

import { keyframeFieldSchema, manualKeyframeTrackInputSchema } from './motion-schemas.js';
import type { ToolSpec } from './spec.js';

export const APPLY_MANUAL_KEYFRAME_TRACK_TOOL_NAME = 'apply_manual_keyframe_track';

export const applyManualKeyframeTrackTool: ToolSpec = {
  name: APPLY_MANUAL_KEYFRAME_TRACK_TOOL_NAME,
  description:
    'Set a hand-authored Figma Motion keyframe track on a node for one field — e.g. TRANSLATION_X, ' +
    'OPACITY, ROTATION, SCALE_XY, or an indexed fills / strokes / effects item. `field` selects what ' +
    'to animate; `track` carries an optional baseValue plus keyframes (each with timelinePosition in ' +
    'seconds, a typed value, and optional easing). Replaces any existing track on that field. Returns ' +
    '{ ok, nodeId }. Motion is a Figma-Design-only beta feature.',
  inputShape: {
    nodeId: z.string().describe('Figma node id to keyframe'),
    field: keyframeFieldSchema,
    track: manualKeyframeTrackInputSchema.describe('baseValue + keyframes for this field'),
  },
  kind: 'write',
};
