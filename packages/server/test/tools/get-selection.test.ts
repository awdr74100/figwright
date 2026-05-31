import { describe, expect, it } from 'vitest';

import { GET_SELECTION_TOOL_NAME, getSelectionTool } from '../../src/tools/get-selection.js';
import { toToolDefinition } from '../tool-schema.js';

const getSelectionToolDefinition = toToolDefinition(getSelectionTool);

describe('get_selection tool definition', () => {
  it('exposes the canonical tool name', () => {
    expect(getSelectionToolDefinition.name).toBe(GET_SELECTION_TOOL_NAME);
    expect(GET_SELECTION_TOOL_NAME).toBe('get_selection');
  });

  it('declares an empty object input schema', () => {
    expect(getSelectionToolDefinition.inputSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
    });
  });

  it('has a description that mentions selection', () => {
    expect(getSelectionToolDefinition.description?.toLowerCase()).toContain('select');
  });
});
