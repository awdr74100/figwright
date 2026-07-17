import type { ToolSpec } from './spec.js';

export const GET_MOTION_STYLES_TOOL_NAME = 'get_motion_styles';

export const getMotionStylesTool: ToolSpec = {
  name: GET_MOTION_STYLES_TOOL_NAME,
  description:
    "List the file's available Figma Motion animation-style presets — the templates you apply with " +
    'apply_animation_style. Returns { styles: [{ styleId, name, description?, props? }] }; the styleId ' +
    'is what apply_animation_style takes and props lists a preset’s tunable keys. Motion is a beta ' +
    'feature, only available in the Figma Design editor.',
  inputShape: {},
  kind: 'read',
};
