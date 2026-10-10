import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const IMPORT_VARIABLE_TOOL_NAME = 'import_variable';

export const importVariableTool: ToolSpec = {
  name: IMPORT_VARIABLE_TOOL_NAME,
  description:
    'Import a published library variable by its key into the current file. Returns ' +
    '{ ok, variableId, name }; use the returned variableId with bind_variable_to_node, ' +
    'bind_variable_to_paint or other variable bindings. A key is not a variable id, and an id ' +
    'from the source library is not a target-file reference. Get the key from get_variable_defs ' +
    'in the source file. Does not bind or edit any node. Unpublished or inaccessible variables ' +
    'are refused by Figma. Import before a batch; library imports cannot be rolled back.',
  inputSchema: z.object({
    variableKey: z.string().min(1).describe('Published variable key, not a variable id'),
  }),
  kind: 'write',
};
