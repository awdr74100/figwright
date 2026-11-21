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
    'seconds, a typed value, and optional easing). Replaces any existing track on that field. ' +
    'TRANSFORM_3D_ROTATION_X / Y / Z (degrees), TRANSFORM_3D_TRANSLATION_Z (px) and ' +
    'SCENE_3D_PERSPECTIVE (px, never negative; frames, components and instances only) animate ' +
    "set_transform_3d's fields: a 3D track's baseValue IS the static value, so giving one rewrites " +
    'it, a node with no 3D transform is given one (all 0) for the track to drive, and a frame with ' +
    'no scene gets one from a perspective baseValue. Returns { ok, nodeId }, with adjusted saying ' +
    'when a 3D track changed the node like this. Motion is a Figma-Design-only beta feature.',
  inputSchema: z.object({
    nodeId: z.string().describe('Figma node id to keyframe'),
    field: keyframeFieldSchema,
    track: manualKeyframeTrackInputSchema.describe('baseValue + keyframes for this field'),
  }),
  kind: 'write',
};
