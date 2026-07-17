import type { GetMotionStylesResult, MotionStyle } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { assertFigmaEditor } from './motion-shared.js';

/** List the file's Figma Motion animation-style presets (the templates apply_animation_style takes). */
export const createGetMotionStylesHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async () => {
    assertFigmaEditor(figmaCtx, 'get_motion_styles');
    const styles: MotionStyle[] = figmaCtx.motion.figmaAnimationStyles().map(s => {
      const style: MotionStyle = { styleId: s.styleId, name: s.name };
      if (s.description !== undefined) style.description = s.description;
      if (s.props !== undefined) style.props = { ...s.props };
      return style;
    });
    const result: GetMotionStylesResult = { styles };
    return result;
  };
