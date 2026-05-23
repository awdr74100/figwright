import { describe, expect, it } from 'vitest';

import { CREATE_FRAME_TOOL_NAME, createFrameToolDefinition } from '../../src/tools/create-frame.js';
import { DELETE_NODES_TOOL_NAME, deleteNodesToolDefinition } from '../../src/tools/delete-nodes.js';
import { RENAME_NODE_TOOL_NAME, renameNodeToolDefinition } from '../../src/tools/rename-node.js';
import { SET_FILLS_TOOL_NAME, setFillsToolDefinition } from '../../src/tools/set-fills.js';
import { SET_OPACITY_TOOL_NAME, setOpacityToolDefinition } from '../../src/tools/set-opacity.js';
import { SET_TEXT_TOOL_NAME, setTextToolDefinition } from '../../src/tools/set-text.js';
import { SET_VISIBLE_TOOL_NAME, setVisibleToolDefinition } from '../../src/tools/set-visible.js';

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

  it('set_opacity / set_visible / rename_node declare nodeId + their value, required', () => {
    expect(setOpacityToolDefinition.name).toBe(SET_OPACITY_TOOL_NAME);
    expect(setOpacityToolDefinition.inputSchema).toMatchObject({
      required: ['nodeId', 'opacity'],
      properties: { opacity: { type: 'number', minimum: 0, maximum: 1 } },
    });
    expect(setVisibleToolDefinition.name).toBe(SET_VISIBLE_TOOL_NAME);
    expect(setVisibleToolDefinition.inputSchema).toMatchObject({
      required: ['nodeId', 'visible'],
      properties: { visible: { type: 'boolean' } },
    });
    expect(renameNodeToolDefinition.name).toBe(RENAME_NODE_TOOL_NAME);
    expect(renameNodeToolDefinition.inputSchema).toMatchObject({
      required: ['nodeId', 'name'],
      properties: { name: { type: 'string' } },
    });
  });

  it('delete_nodes requires a nodeIds string array', () => {
    expect(deleteNodesToolDefinition.name).toBe(DELETE_NODES_TOOL_NAME);
    expect(deleteNodesToolDefinition.inputSchema).toMatchObject({
      required: ['nodeIds'],
      properties: { nodeIds: { type: 'array', items: { type: 'string' } } },
    });
  });

  it('write tools do not expose requestId in their MCP schema (server injects it)', () => {
    for (const def of [
      setFillsToolDefinition,
      setTextToolDefinition,
      createFrameToolDefinition,
      setOpacityToolDefinition,
      setVisibleToolDefinition,
      renameNodeToolDefinition,
      deleteNodesToolDefinition,
    ]) {
      const props = def.inputSchema.properties as Record<string, unknown>;
      expect(props.requestId).toBeUndefined();
    }
  });
});
