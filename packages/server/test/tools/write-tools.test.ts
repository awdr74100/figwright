import { describe, expect, it } from 'vitest';

import { BATCH_TOOL_NAME, batchTool } from '../../src/tools/batch.js';
import { CLONE_NODE_TOOL_NAME, cloneNodeTool } from '../../src/tools/clone-node.js';
import { CREATE_FRAME_TOOL_NAME, createFrameTool } from '../../src/tools/create-frame.js';
import { CREATE_INSTANCE_TOOL_NAME, createInstanceTool } from '../../src/tools/create-instance.js';
import {
  CREATE_RECTANGLE_TOOL_NAME,
  createRectangleTool,
} from '../../src/tools/create-rectangle.js';
import { CREATE_TEXT_TOOL_NAME, createTextTool } from '../../src/tools/create-text.js';
import { DELETE_NODES_TOOL_NAME, deleteNodesTool } from '../../src/tools/delete-nodes.js';
import { LOCK_NODES_TOOL_NAME, lockNodesTool } from '../../src/tools/lock-nodes.js';
import { MOVE_NODES_TOOL_NAME, moveNodesTool } from '../../src/tools/move-nodes.js';
import { RENAME_NODE_TOOL_NAME, renameNodeTool } from '../../src/tools/rename-node.js';
import { RESIZE_NODES_TOOL_NAME, resizeNodesTool } from '../../src/tools/resize-nodes.js';
import { ROTATE_NODES_TOOL_NAME, rotateNodesTool } from '../../src/tools/rotate-nodes.js';
import { SET_AUTO_LAYOUT_TOOL_NAME, setAutoLayoutTool } from '../../src/tools/set-auto-layout.js';
import { SET_BLEND_MODE_TOOL_NAME, setBlendModeTool } from '../../src/tools/set-blend-mode.js';
import { SET_CONSTRAINTS_TOOL_NAME, setConstraintsTool } from '../../src/tools/set-constraints.js';
import {
  SET_CORNER_RADIUS_TOOL_NAME,
  setCornerRadiusTool,
} from '../../src/tools/set-corner-radius.js';
import { SET_FILLS_TOOL_NAME, setFillsTool } from '../../src/tools/set-fills.js';
import { SET_OPACITY_TOOL_NAME, setOpacityTool } from '../../src/tools/set-opacity.js';
import { SET_STROKES_TOOL_NAME, setStrokesTool } from '../../src/tools/set-strokes.js';
import {
  SET_TEXT_PROPERTIES_TOOL_NAME,
  setTextPropertiesTool,
} from '../../src/tools/set-text-properties.js';
import { SET_TEXT_TOOL_NAME, setTextTool } from '../../src/tools/set-text.js';
import { SET_VISIBLE_TOOL_NAME, setVisibleTool } from '../../src/tools/set-visible.js';
import { UNLOCK_NODES_TOOL_NAME, unlockNodesTool } from '../../src/tools/unlock-nodes.js';
import { toToolDefinition } from '../tool-schema.js';

const batchToolDefinition = toToolDefinition(batchTool);
const cloneNodeToolDefinition = toToolDefinition(cloneNodeTool);
const createFrameToolDefinition = toToolDefinition(createFrameTool);
const createInstanceToolDefinition = toToolDefinition(createInstanceTool);
const createRectangleToolDefinition = toToolDefinition(createRectangleTool);
const createTextToolDefinition = toToolDefinition(createTextTool);
const deleteNodesToolDefinition = toToolDefinition(deleteNodesTool);
const lockNodesToolDefinition = toToolDefinition(lockNodesTool);
const moveNodesToolDefinition = toToolDefinition(moveNodesTool);
const renameNodeToolDefinition = toToolDefinition(renameNodeTool);
const resizeNodesToolDefinition = toToolDefinition(resizeNodesTool);
const rotateNodesToolDefinition = toToolDefinition(rotateNodesTool);
const setAutoLayoutToolDefinition = toToolDefinition(setAutoLayoutTool);
const setBlendModeToolDefinition = toToolDefinition(setBlendModeTool);
const setConstraintsToolDefinition = toToolDefinition(setConstraintsTool);
const setCornerRadiusToolDefinition = toToolDefinition(setCornerRadiusTool);
const setFillsToolDefinition = toToolDefinition(setFillsTool);
const setOpacityToolDefinition = toToolDefinition(setOpacityTool);
const setStrokesToolDefinition = toToolDefinition(setStrokesTool);
const setTextPropertiesToolDefinition = toToolDefinition(setTextPropertiesTool);
const setTextToolDefinition = toToolDefinition(setTextTool);
const setVisibleToolDefinition = toToolDefinition(setVisibleTool);
const unlockNodesToolDefinition = toToolDefinition(unlockNodesTool);

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
    // All inputs optional → Zod omits `required` entirely (vs an empty array).
    expect(createFrameToolDefinition.inputSchema.required).toBeUndefined();
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
    expect(createRectangleToolDefinition.inputSchema.required).toBeUndefined();
  });

  it('set_corner_radius / set_strokes / move_nodes / resize_nodes declare their inputs', () => {
    expect(setCornerRadiusToolDefinition.name).toBe(SET_CORNER_RADIUS_TOOL_NAME);
    expect(setCornerRadiusToolDefinition.inputSchema).toMatchObject({
      required: ['nodeId', 'radius'],
    });
    expect(setStrokesToolDefinition.name).toBe(SET_STROKES_TOOL_NAME);
    expect(setStrokesToolDefinition.inputSchema).toMatchObject({ required: ['nodeId', 'strokes'] });
    expect(moveNodesToolDefinition.name).toBe(MOVE_NODES_TOOL_NAME);
    expect(moveNodesToolDefinition.inputSchema).toMatchObject({ required: ['nodeIds'] });
    expect(resizeNodesToolDefinition.name).toBe(RESIZE_NODES_TOOL_NAME);
    expect(resizeNodesToolDefinition.inputSchema).toMatchObject({
      required: ['nodeIds', 'width', 'height'],
    });
  });

  it('set_auto_layout / set_blend_mode / set_constraints / rotate_nodes / clone_node / lock+unlock declare inputs', () => {
    expect(setAutoLayoutToolDefinition.name).toBe(SET_AUTO_LAYOUT_TOOL_NAME);
    expect(setAutoLayoutToolDefinition.inputSchema).toMatchObject({
      required: ['nodeId', 'layoutMode'],
      properties: { layoutMode: { enum: ['NONE', 'HORIZONTAL', 'VERTICAL', 'GRID'] } },
    });
    expect(setBlendModeToolDefinition.name).toBe(SET_BLEND_MODE_TOOL_NAME);
    expect(setBlendModeToolDefinition.inputSchema).toMatchObject({
      required: ['nodeId', 'blendMode'],
    });
    expect(setConstraintsToolDefinition.name).toBe(SET_CONSTRAINTS_TOOL_NAME);
    expect(setConstraintsToolDefinition.inputSchema).toMatchObject({
      required: ['nodeId', 'horizontal', 'vertical'],
    });
    expect(rotateNodesToolDefinition.name).toBe(ROTATE_NODES_TOOL_NAME);
    expect(rotateNodesToolDefinition.inputSchema).toMatchObject({
      required: ['nodeIds', 'rotation'],
    });
    expect(cloneNodeToolDefinition.name).toBe(CLONE_NODE_TOOL_NAME);
    expect(cloneNodeToolDefinition.inputSchema).toMatchObject({ required: ['nodeId'] });
    expect(lockNodesToolDefinition.name).toBe(LOCK_NODES_TOOL_NAME);
    expect(unlockNodesToolDefinition.name).toBe(UNLOCK_NODES_TOOL_NAME);
    for (const def of [lockNodesToolDefinition, unlockNodesToolDefinition]) {
      expect(def.inputSchema).toMatchObject({ required: ['nodeIds'] });
    }
  });

  it('create_instance takes componentId/componentKey + placement, none required', () => {
    expect(createInstanceToolDefinition.name).toBe(CREATE_INSTANCE_TOOL_NAME);
    expect(createInstanceToolDefinition.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        componentId: { type: 'string' },
        componentKey: { type: 'string' },
        parentId: { type: 'string' },
      },
    });
    expect(createInstanceToolDefinition.inputSchema.required).toBeUndefined();
  });

  it('set_text_properties requires nodeId; truncation/maxLines/autoResize optional', () => {
    expect(setTextPropertiesToolDefinition.name).toBe(SET_TEXT_PROPERTIES_TOOL_NAME);
    expect(setTextPropertiesToolDefinition.inputSchema).toMatchObject({
      required: ['nodeId'],
      properties: {
        textTruncation: { enum: ['DISABLED', 'ENDING'] },
        maxLines: { anyOf: [{ type: 'number' }, { type: 'null' }] },
        textAutoResize: { enum: ['NONE', 'HEIGHT', 'WIDTH_AND_HEIGHT', 'TRUNCATE'] },
      },
    });
  });

  it('batch requires a non-empty ops array of { tool, params } and hides requestId', () => {
    expect(batchToolDefinition.name).toBe(BATCH_TOOL_NAME);
    expect(batchToolDefinition.inputSchema).toMatchObject({
      type: 'object',
      required: ['ops'],
      properties: {
        ops: {
          type: 'array',
          minItems: 1,
          items: { type: 'object', required: ['tool'], properties: { tool: { type: 'string' } } },
        },
      },
    });
    const props = batchToolDefinition.inputSchema.properties as Record<string, unknown>;
    expect(props.requestId).toBeUndefined();
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
      setAutoLayoutToolDefinition,
      setBlendModeToolDefinition,
      setConstraintsToolDefinition,
      rotateNodesToolDefinition,
      lockNodesToolDefinition,
      unlockNodesToolDefinition,
      cloneNodeToolDefinition,
    ]) {
      const props = def.inputSchema.properties as Record<string, unknown>;
      expect(props.requestId).toBeUndefined();
    }
  });
});
