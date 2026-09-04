import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const GET_FONTS_TOOL_NAME = 'get_fonts';

export const getFontsTool: ToolSpec = {
  name: GET_FONTS_TOOL_NAME,
  description:
    'Return every font used on the current page as { fonts: [{ fontName, count }] }, sorted by ' +
    'usage frequency (descending). Mixed-font text contributes one count per styled segment. ' +
    'fontName carries variationSettings for a variable font — two rows sharing a family + style ' +
    'but differing there are different weights, not duplicates. A sibling variationAxes ' +
    '{ family: ["wght", "slnt", ...] } lists the OpenType axes each variable family exposes: ' +
    'those are the tags the write tools accept in fontName.variationSettings. A family missing ' +
    'from it is static.',
  inputSchema: z.object({}),
  kind: 'read',
};
