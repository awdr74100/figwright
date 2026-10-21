/**
 * How a node is turned within its parent, as the plugin API's `rotation` alone cannot say: a
 * mirrored node (Flip horizontal / vertical) has a transform whose determinant is negative, and
 * `rotation` reads the same with or without the flip (a node flipped top-to-bottom reads 0).
 */

const round2 = (v: number): number => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
};

const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-4;

/**
 * A turned box's bounding box in its parent's axes, as offsets from its origin (x / y). This is the
 * room an auto-layout parent gives it — measured: a 100 × 60 node turned 30° takes 116.6 px of a
 * row and is centred by its 102 px height.
 */
export const boundingBoxOf = (
  [[a, c], [b, d]]: Transform,
  width: number,
  height: number,
): { x: number; y: number; width: number; height: number } => {
  const xs = [0, a * width, c * height, a * width + c * height];
  const ys = [0, b * width, d * height, b * width + d * height];
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    x: round2(minX),
    y: round2(minY),
    width: round2(Math.max(...xs) - minX),
    height: round2(Math.max(...ys) - minY),
  };
};

export interface Orientation {
  /** Mirrored: its own axes are reversed relative to its parent's. */
  flipped: boolean;
  /**
   * The CSS transform that turns the node's box into place, with transform-origin 0 0 at the node's
   * x / y (its origin, which a turned node's bounding box does not start at). Undefined for a node
   * that is neither rotated nor flipped.
   */
  cssTransform: string | undefined;
}

/**
 * Figma writes a transform as [[a, c, e], [b, d, f]] and a turn as rotate(θ) then, if flipped, a
 * mirror of its own y axis; in CSS (y down, clockwise angles) that is rotate(atan2(b, a))
 * scaleY(-1). A transform that also scales or skews (not something Figma's own tools make) is
 * written out as a matrix.
 */
export const orientationOf = ([[a, c], [b, d]]: Transform): Orientation => {
  const flipped = a * d - b * c < 0;
  const orthonormal = near(a * a + b * b, 1) && near(c * c + d * d, 1) && near(a * c + b * d, 0);
  if (!orthonormal) {
    return {
      flipped,
      cssTransform: `matrix(${[a, b, c, d].map(round2).join(', ')}, 0, 0)`,
    };
  }
  const deg = round2((Math.atan2(b, a) * 180) / Math.PI);
  if (!flipped) return { flipped, cssTransform: deg === 0 ? undefined : `rotate(${deg}deg)` };
  // A flip and a half turn is a mirror of the other axis.
  if (Math.abs(Math.abs(deg) - 180) < 0.01) return { flipped, cssTransform: 'scaleX(-1)' };
  return { flipped, cssTransform: deg === 0 ? 'scaleY(-1)' : `rotate(${deg}deg) scaleY(-1)` };
};
