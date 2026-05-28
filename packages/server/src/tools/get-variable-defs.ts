import { specToToolDefinition, type ToolSpec } from './spec.js';

export const GET_VARIABLE_DEFS_TOOL_NAME = 'get_variable_defs';

export const getVariableDefsTool: ToolSpec = {
  name: GET_VARIABLE_DEFS_TOOL_NAME,
  description:
    "Return the document's local variables as { collections, variables }. Each collection lists its modes " +
    'and defaultModeId; each variable lists its resolvedType and valuesByMode (primitives, RGBA colors, ' +
    'or { type: "VARIABLE_ALIAS", id } references to other variables).',
  inputShape: {},
  kind: 'read',
};

export const getVariableDefsToolDefinition = specToToolDefinition(getVariableDefsTool);
