/**
 * Derive the CSS angle of a linear gradient from Figma's `gradientTransform`.
 *
 * Why this lives in the serializer rather than in the consumer: the angle is NOT a property of the
 * matrix alone — it depends on the owning node's aspect ratio. Figma positions a gradient in the
 * node's _normalized_ space (0–1 across width, 0–1 across height), but a CSS angle is measured in
 * pixel space, so the same matrix means different angles on differently shaped nodes. The matrix
 * `[[0.5, 0.5, 0], [0, 1, 0]]` is 135deg on a 200×200 node but 165.96deg on a 400×100 one. Handing
 * the raw matrix downstream asks the consumer to do that correction at generation time, at a point
 * where the node's width and height are already in hand right here.
 *
 * How a linear gradient actually reads the matrix (verified against live Figma renders, see
 * gradient-angle.test.ts `pinsFigmaConvention`): the colour at normalized point (x, y) is decided
 * by the ramp coordinate
 *
 *     t = a·x + b·y + c        where the first row of gradientTransform is [a, b, c]
 *
 * So the iso-colour lines are the level sets of t and the ramp runs along ∇t. **Only the first row
 * participates** — the second row parameterises the perpendicular axis, which a linear ramp ignores
 * (it is what the radial / angular / diamond types use). Substituting x = xₚ/width and y =
 * yₚ/height puts ∇t in pixel space at (a/width, b/height): the node's dimensions **divide**, they
 * do not multiply.
 *
 * The angle is in the node's own (unrotated) frame, like its width and height — a rotated node
 * carries its `rotation` separately, and the gradient turns with the element rather than against
 * it.
 *
 * `gradientTransform` is still serialized alongside this: it is what the write side round-trips,
 * and it stays the authority for the gradient types this function deliberately does not cover.
 * Nothing reads `cssAngle` back — writing a paint ignores it entirely.
 */

/** A 2×3 affine matrix, as rows of 3 — the shape Figma's `gradientTransform` uses. */
type Matrix2x3 = readonly (readonly number[])[];

/**
 * The CSS angle, in degrees, of a `GRADIENT_LINEAR` paint on a node of the given size.
 *
 * Returns undefined when the angle is not derivable — a node with no area, a malformed matrix, or a
 * first row with no direction in it — because a wrong angle is worse than an absent one: absent
 * makes the consumer fall back to the matrix, wrong makes it confidently emit a visibly rotated
 * gradient.
 */
export const cssAngleFromGradientTransform = (
  transform: Matrix2x3,
  width: number,
  height: number,
): number | undefined => {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return undefined;
  }
  // Validate the documented 2×3 shape even though only the first row carries the ramp axis: a matrix
  // that isn't that shape didn't come from Figma, and guessing at it would be inventing a direction.
  const row = transform[0];
  if (transform.length !== 2 || row === undefined || row.length !== 3) return undefined;
  if (transform[1]?.length !== 3) return undefined;
  const [a, b] = row as [number, number, number];
  if (!Number.isFinite(a) || !Number.isFinite(b)) return undefined;
  // ∇t in pixel space. The unit square is stretched to the node's real size, so a given change in
  // normalized x costs `width` pixels — the dimensions divide.
  const dx = a / width;
  const dy = b / height;
  // A zero first row has no direction: every point has the same ramp coordinate, so there is no
  // angle to report.
  if (dx === 0 && dy === 0) return undefined;
  // CSS angles start at 0deg pointing up and increase clockwise, while the design-space y axis grows
  // downward — hence atan2(dx, -dy) rather than the usual atan2(dy, dx).
  const deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
  const normalized = ((deg % 360) + 360) % 360;
  // Two decimals keeps a sub-pixel-accurate angle without spending payload on float noise.
  return Math.round(normalized * 100) / 100;
};
