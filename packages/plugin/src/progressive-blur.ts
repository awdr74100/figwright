/**
 * Ready-to-emit CSS for a progressive blur — a blur that ramps from `startRadius` at `startOffset`
 * to `radius` at `endOffset` across the node. CSS has no gradient blur, and the recipe that matches
 * Figma's own render is too much arithmetic to leave to whoever reads the payload, so it is derived
 * here, where the node's size is in hand (the offsets are fractions of it, so the ramp's angle
 * depends on the node's proportions, as a linear gradient's does).
 *
 * Measured against Figma renders over a striped backdrop (mean |Δ| on 0–255), on five cases
 * including a non-square node, a diagonal ramp, offsets inside the box and a startRadius above 0:
 *
 * - BACKGROUND_BLUR: four `backdrop-filter` overlays stacked over the node, each faded in along its
 *   quarter of the ramp, 2.1–2.9; one masked overlay, 6.5–18; a uniform blur, 16–35.
 * - LAYER_BLUR: four blurred copies of the content stacked over it, faded in the same way, 1.1; a
 *   uniform blur, 10.7.
 *
 * Two measured facts shape the steps. A Figma blur radius is a CSS blur of `radius × 0.45` (radii
 * 2–32, background and layer blurs alike). And backdrop filters stack: each overlay blurs what the
 * ones below it already blurred, so blurs add in quadrature, and each overlay adds only the blur
 * still missing — `0.45 · √(t_k² − t_{k−1}²)`. Copies of the content each blur the sharp original,
 * so each takes its full target.
 */

export interface ProgressiveBlurInput {
  type: 'LAYER_BLUR' | 'BACKGROUND_BLUR';
  radius: number;
  startRadius: number;
  startOffset: { x: number; y: number };
  endOffset: { x: number; y: number };
}

/** A Figma blur radius as a CSS blur standard deviation (measured; see above). */
export const CSS_BLUR_PER_RADIUS = 0.45;

const STEPS = 4;
const fixed = (n: number): string => n.toFixed(2);

/**
 * The CSS angle of the line from `start` to `end`, and where each lands on that gradient line, as
 * percentages — the projection CSS itself uses for `linear-gradient(<angle>, …)` on a w×h box.
 */
export const progressiveMaskLine = (
  width: number,
  height: number,
  start: { x: number; y: number },
  end: { x: number; y: number },
): { angle: number; from: number; to: number } => {
  const angle = Math.atan2((end.x - start.x) * width, -(end.y - start.y) * height);
  const ux = Math.sin(angle);
  const uy = -Math.cos(angle);
  const length = Math.abs(width * ux) + Math.abs(height * uy);
  const at = (p: { x: number; y: number }): number =>
    (((p.x - 0.5) * width * ux + (p.y - 0.5) * height * uy) / length + 0.5) * 100;
  return { angle: (angle * 180) / Math.PI, from: at(start), to: at(end) };
};

/**
 * The layers that draw a progressive blur, bottom to top, each a CSS declaration list.
 * BACKGROUND_BLUR: each is an overlay box covering the node, stacked in this order over the node's
 * own background (the order the measurement used). LAYER_BLUR: the first styles the node's content
 * itself, every later one a copy of that content stacked over it. `undefined` when the node's size
 * is unknown (an effect style) or the ramp has no length.
 */
export const cssProgressiveBlurLayers = (
  blur: ProgressiveBlurInput,
  ownerSize: { width: number; height: number } | null,
): string[] | undefined => {
  if (ownerSize === null || ownerSize.width <= 0 || ownerSize.height <= 0) return undefined;
  const { startOffset: start, endOffset: end } = blur;
  if (start.x === end.x && start.y === end.y) return undefined;
  const { angle, from, to } = progressiveMaskLine(ownerSize.width, ownerSize.height, start, end);
  const property = blur.type === 'BACKGROUND_BLUR' ? 'backdrop-filter' : 'filter';
  const target = (k: number): number =>
    blur.startRadius + ((blur.radius - blur.startRadius) * k) / STEPS;

  const layers: string[] = [];
  // The blur everything gets: an unmasked overlay, or the content's own blur. A sharp start needs
  // none behind the overlays, but the content itself is still the bottom layer of a layer blur.
  if (blur.startRadius > 0) {
    layers.push(`${property}: blur(${fixed(blur.startRadius * CSS_BLUR_PER_RADIUS)}px)`);
  } else if (blur.type === 'LAYER_BLUR') {
    layers.push('filter: none');
  }
  for (let k = 1; k <= STEPS; k++) {
    const sigma =
      blur.type === 'BACKGROUND_BLUR'
        ? Math.sqrt(Math.max(target(k) ** 2 - target(k - 1) ** 2, 0)) * CSS_BLUR_PER_RADIUS
        : target(k) * CSS_BLUR_PER_RADIUS;
    const p0 = from + ((to - from) * (k - 1)) / STEPS;
    const p1 = from + ((to - from) * k) / STEPS;
    layers.push(
      `${property}: blur(${fixed(sigma)}px); mask-image: linear-gradient(${fixed(angle)}deg, ` +
        `transparent ${fixed(p0)}%, black ${fixed(p1)}%)`,
    );
  }
  return layers;
};
