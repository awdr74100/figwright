import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const SET_TRANSFORM_3D_TOOL_NAME = 'set_transform_3d';

const axis = z.object({
  unit: z.enum(['PERCENT', 'PIXELS']).describe('PERCENT of the node’s width / height, or PIXELS'),
  value: z.number().describe('Offset from the left (x) or top (y) edge; 50 PERCENT is the centre'),
});

export const setTransform3dTool: ToolSpec = {
  name: SET_TRANSFORM_3D_TOOL_NAME,
  description:
    "Turn a node in 3D (beta in Figma's API) — rotate it about X / Y / Z, push it toward or away " +
    'from the viewer — and give a frame, component or instance the 3D scene its children share. ' +
    'transform3d: { translateZ px, rotateX / rotateY / rotateZ degrees, backfaceVisible, visible } ' +
    'applied as CSS translateZ → rotateX → rotateY → rotateZ about transformOrigin, in the ' +
    "node's own (already turned) axes; { type:'NONE' } removes it, and with it the node's 3D " +
    'keyframe tracks. transformOrigin: { x, y } each { unit: PERCENT | PIXELS, value } — the ' +
    'point it turns about (default the centre); it draws nothing without a transform. scene3d: ' +
    '{ perspective px (negative = none), preserve3d (children share one 3D space, drawn by ' +
    'depth), visible } — on the container, not the turned layers — or null to clear it (an ' +
    'instance then stops inheriting its main component’s). Every object is merged with what the ' +
    'node holds: a field left out keeps its value. Nothing moves or resizes: x / y, the box and the ' +
    "layout stay as they were. Under preserve3d Figma ignores the container's own opacity, blend " +
    'mode, effects and clipping; put those on a flat ancestor. Returns { ok, nodeId } with the ' +
    'node’s 3D fields read back as get_node reads them (each absent when none), and adjusted ' +
    'when the call changed more (keyframe tracks removed) or less (a scene with perspective -1 ' +
    'and no preserve3d is none) than it said.',
  inputSchema: z.object({
    nodeId: z.string().describe('Node to turn, or frame / component / instance to hold the scene'),
    transform3d: z
      .object({
        type: z
          .enum(['FIXED_ORDER', 'NONE'])
          .optional()
          .describe('NONE removes the transform (give nothing else); FIXED_ORDER is the default'),
        translateZ: z.number().optional().describe('Toward the viewer, in px'),
        rotateX: z.number().optional().describe('Degrees about the X axis (tips top / bottom)'),
        rotateY: z.number().optional().describe('Degrees about the Y axis (swings left / right)'),
        rotateZ: z.number().optional().describe('Degrees about the Z axis, after X and Y'),
        backfaceVisible: z.boolean().optional().describe('false hides the layer turned away'),
        visible: z.boolean().optional().describe('false switches it off and keeps its values'),
      })
      .optional(),
    transformOrigin: z.object({ x: axis.optional(), y: axis.optional() }).optional(),
    scene3d: z
      .object({
        perspective: z
          .number()
          .optional()
          .describe('Distance to the viewer in px; negative = no perspective; 0–1 draw as 1'),
        preserve3d: z
          .boolean()
          .optional()
          .describe('true: children share one 3D space; false: each is flattened into the frame'),
        visible: z.boolean().optional().describe('false switches the perspective off'),
      })
      .nullable()
      .optional()
      .describe('The scene, or null to clear it'),
  }),
  kind: 'write',
};
