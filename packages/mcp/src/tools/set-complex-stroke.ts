import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const SET_COMPLEX_STROKE_TOOL_NAME = 'set_complex_stroke';

/** Figma's first-party brushes. A CUSTOM brush reads back but cannot be set through the API. */
export const STRETCH_BRUSHES = [
  'HEIST',
  'BLOCKBUSTER',
  'GRINDHOUSE',
  'BIOPIC',
  'SPAGHETTI_WESTERN',
  'SLASHER',
  'HARDBOILED',
  'VERITE',
  'EPIC',
  'SCREWBALL',
  'ROM_COM',
  'NOIR',
  'PROPAGANDA',
  'MELODRAMA',
  'NEW_WAVE',
] as const;

export const SCATTER_BRUSHES = [
  'BUBBLEGUM',
  'WITCH_HOUSE',
  'SHOEGAZE',
  'HONKY_TONK',
  'SCREAMO',
  'DRONE',
  'DOO_WOP',
  'SPOKEN_WORD',
  'VAPORWAVE',
  'OI',
] as const;

export const setComplexStrokeTool: ToolSpec = {
  name: SET_COMPLEX_STROKE_TOOL_NAME,
  description:
    "Give a node's stroke a Figma Draw look — a brush, a hand-drawn wobble or a width that varies " +
    'along it — on any node with a stroke (paths, shapes, frames, text). complexStrokeProperties: ' +
    "{ type:'BRUSH', brushType:'STRETCH', brushName, direction } drags one textured stroke along " +
    "the path; { type:'BRUSH', brushType:'SCATTER', brushName, gap, wiggle, sizeJitter, " +
    "angularJitter, rotation } stamps the brush along it; { type:'DYNAMIC', frequency, wiggle, " +
    "smoothen } wobbles it; { type:'BASIC' } goes back to a plain stroke. Fields left out take the " +
    "brush's own defaults. variableWidthStrokeProperties: { widthProfile } with a preset (WEDGE, " +
    'TAPER, QUARTER_TAPER, EYE, MIRRORED_TAPER; UNIFORM = constant), or CUSTOM with ' +
    'variableWidthPoints [{ position 0–1 along the stroke, width }] — the stroke is 2 × width × ' +
    'strokeWeight thick there, so 0.5 is its normal weight and 1 twice it; a vector that branches ' +
    'cannot take one. Both may be combined. The node needs a visible stroke first (set_strokes) — ' +
    'its colour and weight still apply. Any of these draws the stroke solid: a dash pattern stays ' +
    'set but is not drawn. These are the same fields get_node reads. Returns { ok, nodeId }.',
  inputSchema: z.object({
    nodeId: z.string().describe('Node whose stroke to restyle'),
    complexStrokeProperties: z
      .object({
        type: z.enum(['BASIC', 'BRUSH', 'DYNAMIC']),
        brushType: z.enum(['STRETCH', 'SCATTER']).optional().describe('BRUSH: which kind'),
        brushName: z
          .enum([...STRETCH_BRUSHES, ...SCATTER_BRUSHES])
          .optional()
          .describe(
            `BRUSH: STRETCH brushes ${STRETCH_BRUSHES.join(', ')}; SCATTER brushes ` +
              SCATTER_BRUSHES.join(', '),
          ),
        direction: z
          .enum(['FORWARD', 'BACKWARD'])
          .optional()
          .describe('STRETCH: which way the brush runs along the path'),
        gap: z.number().min(0.25).optional().describe('SCATTER: space between stamps (≥ 0.25)'),
        wiggle: z
          .number()
          .min(0)
          .optional()
          .describe('SCATTER / DYNAMIC: random sideways movement (≥ 0)'),
        sizeJitter: z.number().min(0).max(3).optional().describe('SCATTER: size variation 0–3'),
        angularJitter: z
          .number()
          .min(-180)
          .max(180)
          .optional()
          .describe('SCATTER: angle variation in degrees'),
        rotation: z
          .number()
          .min(-180)
          .max(180)
          .optional()
          .describe('SCATTER: rotation of every stamp in degrees'),
        frequency: z.number().min(0.01).max(20).optional().describe('DYNAMIC: wobbles, 0.01–20'),
        smoothen: z.number().min(0).max(1).optional().describe('DYNAMIC: smoothing, 0–1'),
      })
      .optional(),
    variableWidthStrokeProperties: z
      .object({
        widthProfile: z.enum([
          'UNIFORM',
          'WEDGE',
          'TAPER',
          'QUARTER_TAPER',
          'EYE',
          'MIRRORED_TAPER',
          'CUSTOM',
        ]),
        variableWidthPoints: z
          .array(
            z.object({
              position: z.number().min(0).max(1).describe('0–1 along the stroke'),
              width: z
                .number()
                .min(0)
                .describe('Width there: 0.5 = the stroke’s own weight, 1 = twice it'),
            }),
          )
          .min(1)
          .optional()
          .describe('CUSTOM only: the width at each point (a preset reports its own on read)'),
      })
      .optional(),
  }),
  kind: 'write',
};
