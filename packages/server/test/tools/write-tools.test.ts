import { describe, expect, it } from 'vitest';

import { CREATE_FRAME_TOOL_NAME, createFrameToolDefinition } from '../../src/tools/create-frame.js';
import { CREATE_RECTANGLE_TOOL_NAME, createRectangleToolDefinition } from '../../src/tools/create-rectangle.js';
import { CREATE_TEXT_TOOL_NAME, createTextToolDefinition } from '../../src/tools/create-text.js';
import { DELETE_NODES_TOOL_NAME, deleteNodesToolDefinition } from '../../src/tools/delete-nodes.js';
import { MOVE_NODES_TOOL_NAME, moveNodesToolDefinition } from '../../src/tools/move-nodes.js';
import { RENAME_NODE_TOOL_NAME, renameNodeToolDefinition } from '../../src/tools/rename-node.js';
import { RESIZE_NODES_TOOL_NAME, resizeNodesToolDefinition } from '../../src/tools/resize-nodes.js';
import { SET_CORNER_RADIUS_TOOL_NAME, setCornerRadiusToolDefinition } from '../../src/tools/set-corner-radius.js';
import { SET_FILLS_TOOL_NAME, setFillsToolDefinition } from '../../src/tools/set-fills.js';
import { SET_OPACITY_TOOL_NAME, setOpacityToolDefinition } from '../../src/tools/set-opacity.js';
import { SET_STROKES_TOOL_NAME, setStrokesToolDefinition } from '../../src/tools/set-strokes.js';
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

  it('create_text / create_rectangle declare their inputs', () => {
    expect(createTextToolDefinition.name).toBe(CREATE_TEXT_TOOL_NAME);
    expect(createTextToolDefinition.inputSchema).toMatchObject({
      required: ['characters'],
      properties: { characters: { type: 'string' } },
    });
    expect(createRectangleToolDefinition.name).toBe(CREATE_RECTANGLE_TOOL_NAME);
    expect(createRectangleToolDefinition.inputSchema.required).toEqual([]);
  });

  it('set_corner_radius / set_strokes / move_nodes / resize_nodes declare their inputs', () => {
    expect(setCornerRadiusToolDefinition.name).toBe(SET_CORNER_RADIUS_TOOL_NAME);
    expect(setCornerRadiusToolDefinition.inputSchema).toMatchObject({ required: ['nodeId', 'radius'] });
    expect(setStrokesToolDefinition.name).toBe(SET_STROKES_TOOL_NAME);
    expect(setStrokesToolDefinition.inputSchema).toMatchObject({ required: ['nodeId', 'strokes'] });
    expect(moveNodesToolDefinition.name).toBe(MOVE_NODES_TOOL_NAME);
    expect(moveNodesToolDefinition.inputSchema).toMatchObject({ required: ['nodeIds'] });
    expect(resizeNodesToolDefinition.name).toBe(RESIZE_NODES_TOOL_NAME);
    expect(resizeNodesToolDefinition.inputSchema).toMatchObject({ required: ['nodeIds', 'width', 'height'] });
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
      createTextToolDefinition,
      createRectangleToolDefinition,
      setCornerRadiusToolDefinition,
      setStrokesToolDefinition,
      moveNodesToolDefinition,
      resizeNodesToolDefinition,
    ]) {
      const props = def.inputSchema.properties as Record<string, unknown>;
      expect(props.requestId).toBeUndefined();
    }
  });
});
