import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const IMPORT_STYLE_TOOL_NAME = 'import_style';

export const importStyleTool: ToolSpec = {
  name: IMPORT_STYLE_TOOL_NAME,
  description:
    'Import a published library paint, text, effect or grid style by its key into the current ' +
    'file. Returns { ok, styleId, name }; use the returned styleId with apply_style_to_node. ' +
    'A key is not a style id, and an id from the source library is not a target-file reference. ' +
    'Get the key from get_styles in the source file. Does not apply the style or edit any node. ' +
    'Unpublished or inaccessible styles are refused by Figma. Import before a batch; library ' +
    'imports cannot be rolled back.',
  inputSchema: z.object({
    styleKey: z.string().min(1).describe('Published style key, not a style id'),
  }),
  kind: 'write',
};
