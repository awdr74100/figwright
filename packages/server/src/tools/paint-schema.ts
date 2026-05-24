// Shared JSON-schema fragment for a paint input, reused by set_fills / set_strokes /
// create_paint_style / update_paint_style so the SOLID + gradient shape can't drift between them.
// The schema is permissive (only `type` is required); the plugin's toFigmaPaint enforces that a
// gradient carries gradientStops + a 2×3 gradientTransform, and rejects unsupported types.

const rgb = {
  type: 'object' as const,
  properties: { r: { type: 'number' }, g: { type: 'number' }, b: { type: 'number' } },
  required: ['r', 'g', 'b'],
};

const rgba = {
  type: 'object' as const,
  properties: {
    r: { type: 'number' },
    g: { type: 'number' },
    b: { type: 'number' },
    a: { type: 'number' },
  },
  required: ['r', 'g', 'b', 'a'],
};

/** One paint: SOLID (color) or a gradient (gradientStops + gradientTransform). */
export const PAINT_ITEM_SCHEMA = {
  type: 'object' as const,
  properties: {
    type: {
      type: 'string',
      enum: ['SOLID', 'GRADIENT_LINEAR', 'GRADIENT_RADIAL', 'GRADIENT_ANGULAR', 'GRADIENT_DIAMOND'],
    },
    color: { ...rgb, description: 'SOLID color (r/g/b in 0–1)' },
    gradientStops: {
      type: 'array',
      description: 'Gradient stops (position 0–1 + RGBA color); required for gradient types',
      items: {
        type: 'object',
        properties: { position: { type: 'number' }, color: rgba },
        required: ['position', 'color'],
      },
    },
    gradientTransform: {
      type: 'array',
      description: '2×3 affine matrix (two rows of three) positioning the gradient',
      items: { type: 'array', items: { type: 'number' } },
    },
    opacity: { type: 'number' },
    visible: { type: 'boolean' },
  },
  required: ['type'],
} as const;
