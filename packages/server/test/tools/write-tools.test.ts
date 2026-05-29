import { describe, expect, it } from 'vitest';

import { BATCH_TOOL_NAME, batchToolDefinition } from '../../src/tools/batch.js';
import { CLONE_NODE_TOOL_NAME, cloneNodeToolDefinition } from '../../src/tools/clone-node.js';
import { CREATE_FRAME_TOOL_NAME, createFrameToolDefinition } from '../../src/tools/create-frame.js';
import {
  CREATE_INSTANCE_TOOL_NAME,
  createInstanceToolDefinition,
} from '../../src/tools/create-instance.js';
import {
  CREATE_RECTANGLE_TOOL_NAME,
  createRectangleToolDefinition,
} from '../../src/tools/create-rectangle.js';
import { CREATE_TEXT_TOOL_NAME, createTextToolDefinition } from '../../src/tools/create-text.js';
import { DELETE_NODES_TOOL_NAME, deleteNodesToolDefinition } from '../../src/tools/delete-nodes.js';
import { LOCK_NODES_TOOL_NAME, lockNodesToolDefinition } from '../../src/tools/lock-nodes.js';
import { MOVE_NODES_TOOL_NAME, moveNodesToolDefinition } from '../../src/tools/move-nodes.js';
import { RENAME_NODE_TOOL_NAME, renameNodeToolDefinition } from '../../src/tools/rename-node.js';
import { RESIZE_NODES_TOOL_NAME, resizeNodesToolDefinition } from '../../src/tools/resize-nodes.js';
import { ROTATE_NODES_TOOL_NAME, rotateNodesToolDefinition } from '../../src/tools/rotate-nodes.js';
import {
  SET_AUTO_LAYOUT_TOOL_NAME,
  setAutoLayoutToolDefinition,
} from '../../src/tools/set-auto-layout.js';
import {
  SET_BLEND_MODE_TOOL_NAME,
  setBlendModeToolDefinition,
} from '../../src/tools/set-blend-mode.js';
import {
  SET_CONSTRAINTS_TOOL_NAME,
  setConstraintsToolDefinition,
} from '../../src/tools/set-constraints.js';
import {
  SET_CORNER_RADIUS_TOOL_NAME,
  setCornerRadiusToolDefinition,
} from '../../src/tools/set-corner-radius.js';
import { SET_FILLS_TOOL_NAME, setFillsToolDefinition } from '../../src/tools/set-fills.js';
import { SET_OPACITY_TOOL_NAME, setOpacityToolDefinition } from '../../src/tools/set-opacity.js';
import { SET_STROKES_TOOL_NAME, setStrokesToolDefinition } from '../../src/tools/set-strokes.js';
import {
  SET_TEXT_PROPERTIES_TOOL_NAME,
  setTextPropertiesToolDefinition,
} from '../../src/tools/set-text-properties.js';
import { SET_TEXT_TOOL_NAME, setTextToolDefinition } from '../../src/tools/set-text.js';
import { SET_VISIBLE_TOOL_NAME, setVisibleToolDefinition } from '../../src/tools/set-visible.js';
import { UNLOCK_NODES_TOOL_NAME, unlockNodesToolDefinition } from '../../src/tools/unlock-nodes.js';

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
      properties: { layoutMode: { enum: ['NONE', 'HORIZONTAL', 'VERTICAL'] } },
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
