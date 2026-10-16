import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const GET_STYLES_TOOL_NAME = 'get_styles';

export const getStylesTool: ToolSpec = {
  name: GET_STYLES_TOOL_NAME,
  description:
    "Return the document's local styles grouped as { paints, texts, effects, grids }. " +
    'Paint styles carry their paints; text styles carry fontName / fontSize / lineHeight / letterSpacing / textWrapStyle; ' +
    'effect styles carry their effects; grid styles carry their layout grids. ' +
    'Any value the designer bound to a variable carries a `boundVariables` map ({ field: variableId }) ' +
    'on the object that owns it — the individual paint, gradient stop, effect or layout grid, and the ' +
    'text style itself for typography. A bound value is a reference, not a literal: emit the token, ' +
    'not the resolved colour/number sitting next to it. `variables` maps every referenced id to its ' +
    '{ name, type, codeSyntax? } (ids stay the key because variable names collide across ' +
    'collections); it is omitted when nothing in the document is bound. This lists local styles, ' +
    'not all shared styles used by imported instances. To use a published style in another file, ' +
    'pass its key to import_style in that target file and use the returned styleId. A result led ' +
    'by colorProfile: "DISPLAY_P3" comes from a Display P3 file: its colours are P3, so emit one ' +
    'as color(display-p3 r g b), not the plain hex.',
  inputSchema: z.object({}),
  kind: 'read',
};
