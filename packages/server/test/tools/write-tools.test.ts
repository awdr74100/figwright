import { describe, expect, it } from 'vitest';

import { CREATE_FRAME_TOOL_NAME, createFrameToolDefinition } from '../../src/tools/create-frame.js';
import { SET_FILLS_TOOL_NAME, setFillsToolDefinition } from '../../src/tools/set-fills.js';
import { SET_TEXT_TOOL_NAME, setTextToolDefinition } from '../../src/tools/set-text.js';

describe('M2 write tool definitions', () => {
  it('set_fills requires nodeId + fills', () => {
    expect(setFillsToolDefinition.name).toBe(SET_FILLS_TOOL_NAME);
    expect(setFillsToolDefinition.inputSchema).toMatchObject({
      type: 'object',
      required: ['nodeId', 'fills'],
      properties: { nodeId: { type: 'string' }, fills: { type: 'array' } },
    });
  });

  it('set_text requires nodeId + characters', () => {
    expect(setTextToolDefinition.name).toBe(SET_TEXT_TOOL_NAME);
    expect(setTextToolDefinition.inputSchema).toMatchObject({
      type: 'object',
      required: ['nodeId', 'characters'],
      properties: { nodeId: { type: 'string' }, characters: { type: 'string' } },
    });
  });

  it('create_frame has no required input and declares parent/size props', () => {
    expect(createFrameToolDefinition.name).toBe(CREATE_FRAME_TOOL_NAME);
    expect(createFrameToolDefinition.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        parentId: { type: 'string' },
        width: { type: 'number' },
        height: { type: 'number' },
      },
    });
    expect(createFrameToolDefinition.inputSchema.required).toEqual([]);
  });

  it('write tools do not expose requestId in their MCP schema (server injects it)', () => {
    for (const def of [setFillsToolDefinition, setTextToolDefinition, createFrameToolDefinition]) {
      const props = def.inputSchema.properties as Record<string, unknown>;
      expect(props.requestId).toBeUndefined();
    }
  });
});
