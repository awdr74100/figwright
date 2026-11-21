import type {
  SerializedScene3d,
  SerializedTransform3d,
  SerializedTransformOrigin,
} from '@figwright/shared';

/**
 * 3D transforms (beta in the plugin API since typings 1.143): a node's `transform3d` and
 * `transformOrigin`, and a frame / component / instance's `scene3d`. Measured on 2026-11-20 against
 * Figma's own export, rendered in Chrome:
 *
 * - They leave `relativeTransform`, `rotation`, `x` / `y`, the bounding box and the render bounds
 *   unchanged, so a 3D node takes the same room in a layout as without it.
 * - `transformOrigin` does nothing without a 3D transform (a turned node exports the same with either
 *   origin), so it is only reported beside one.
 * - A `FIXED_ORDER` transform renders as CSS `translateZ() rotateX() rotateY() rotateZ()` in that
 *   order, about the origin, in the node's own (already turned) axes, with the same signs as CSS —
 *   39 scenes, all within 0.4% of Figma's pixels; Figma's own SVG export writes the same CSS.
 * - One switched off (`visible: false`) is not drawn at all, though `getCSSAsync` still writes it
 *   out.
 * - The angles come back with float32 noise (30 reads 30.000000834826057), so values are rounded to 4
 *   decimals.
 */

const round4 = (v: number): number => {
  const r = Math.round(v * 10_000) / 10_000;
  return Object.is(r, -0) ? 0 : r;
};

const isDefaultOrigin = (o: TransformOrigin): boolean =>
  o.x.unit === 'PERCENT' && o.x.value === 50 && o.y.unit === 'PERCENT' && o.y.value === 50;

const axisCss = (axis: TransformOriginAxis): string =>
  `${round4(axis.value)}${axis.unit === 'PIXELS' ? 'px' : '%'}`;

const negate = (css: string): string => (css.startsWith('-') ? css.slice(1) : `-${css}`);

/** `matrix()` of a 2×2, and of its inverse — a group's turn and the turn back. */
const matrixCss = ([a, b, c, d]: readonly [number, number, number, number]): string =>
  `matrix(${[a, b, c, d].map(round4).join(', ')}, 0, 0)`;

export interface Transform3dRead {
  transform3d?: SerializedTransform3d;
  transformOrigin?: SerializedTransformOrigin;
  cssTransform3d?: string;
}

/**
 * A node's 3D transform as Figma holds it, and — when it is drawn — the CSS that applies it with
 * `transform-origin: 0 0` at the node's `x` / `y`, written after the node's own `cssTransform`.
 *
 * A GROUP is no coordinate space of its own: its children already carry its turn, so its wrapper
 * stays unturned (the serializer leaves its `cssTransform` out). Its 3D still turns about the
 * group's own axes, so for a turned group the CSS turns into those axes, applies the 3D and turns
 * back.
 */
export const readTransform3d = (node: SceneNode): Transform3dRead => {
  if (!('transform3d' in node)) return {};
  const raw = (node as { transform3d?: unknown }).transform3d as Transform3d | undefined;
  if (raw === undefined || raw === null || raw.type === 'NONE') return {};

  const out: Transform3dRead = {};
  if (raw.type === 'FIXED_ORDER') {
    const t: Extract<SerializedTransform3d, { type: 'FIXED_ORDER' }> = {
      type: 'FIXED_ORDER',
      translateZ: round4(raw.translateZ),
      rotateX: round4(raw.rotateX),
      rotateY: round4(raw.rotateY),
      rotateZ: round4(raw.rotateZ),
    };
    if (raw.backfaceVisible === false) t.backfaceVisible = false;
    if (raw.visible === false) t.visible = false;
    out.transform3d = t;
  } else if (raw.type === 'FREEFORM') {
    const t: Extract<SerializedTransform3d, { type: 'FREEFORM' }> = { type: 'FREEFORM' };
    if (raw.backfaceVisible === false) t.backfaceVisible = false;
    if (raw.visible === false) t.visible = false;
    out.transform3d = t;
  } else {
    return {};
  }

  const origin = (node as { transformOrigin?: TransformOrigin }).transformOrigin;
  if (origin !== undefined && !isDefaultOrigin(origin)) {
    out.transformOrigin = {
      x: { unit: origin.x.unit, value: round4(origin.x.value) },
      y: { unit: origin.y.unit, value: round4(origin.y.value) },
    };
  }

  const t = out.transform3d;
  if (t?.type === 'FIXED_ORDER' && t.visible !== false) {
    const ox = origin === undefined ? '50%' : axisCss(origin.x);
    const oy = origin === undefined ? '50%' : axisCss(origin.y);
    const turn3d =
      `translate(${ox}, ${oy}) translateZ(${t.translateZ}px) rotateX(${t.rotateX}deg) ` +
      `rotateY(${t.rotateY}deg) rotateZ(${t.rotateZ}deg) translate(${negate(ox)}, ${negate(oy)})`;
    const rt = (node as { relativeTransform?: Transform }).relativeTransform;
    const turned =
      rt !== undefined &&
      (node.type === 'GROUP' || node.type === 'TRANSFORM_GROUP') &&
      (Math.abs(rt[0][0] - 1) > 1e-6 ||
        Math.abs(rt[1][0]) > 1e-6 ||
        Math.abs(rt[0][1]) > 1e-6 ||
        Math.abs(rt[1][1] - 1) > 1e-6);
    if (turned) {
      const [[a, c], [b, d]] = rt;
      const det = a * d - b * c;
      out.cssTransform3d = `${matrixCss([a, b, c, d])} ${turn3d} ${matrixCss([d / det, -b / det, -c / det, a / det])}`;
    } else {
      out.cssTransform3d = turn3d;
    }
  }
  return out;
};

/** A frame / component / instance's 3D scene, or nothing when it has none (`null`). */
export const readScene3d = (node: SceneNode): SerializedScene3d | undefined => {
  if (!('scene3d' in node)) return undefined;
  const raw = (node as { scene3d?: Scene3d | null }).scene3d;
  if (raw === undefined || raw === null) return undefined;
  const out: SerializedScene3d = {
    perspective: round4(raw.perspective),
    preserve3d: raw.preserve3d,
  };
  if (raw.visible === false) out.visible = false;
  return out;
};
