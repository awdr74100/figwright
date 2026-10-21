import type {
  SerializedBounds,
  SerializedComplexStroke,
  SerializedTransformModifier,
  SerializedVariableWidthStroke,
} from '@figwright/shared';

// Figma Draw reads: repeat groups, brush / dynamic / variable-width strokes, and the box those paint
// into. Every rule here was measured against what Figma itself draws (its SVG export spells each
// copy of a repeat group out as a `<use transform>`), not taken from the typings — which describe
// RADIAL's offset as a radius when Figma draws it as a diameter.

const round2 = (v: number): number => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
};
const round4 = (v: number): number => Math.round(v * 1e4) / 1e4;

/** An affine map as Figma writes one: [[a, c, e], [b, d, f]] — x' = a·x + c·y + e. */
export type Affine = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
];

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const IDENTITY: Affine = [
  [1, 0, 0],
  [0, 1, 0],
];

export const compose = (outer: Affine, inner: Affine): Affine => {
  const [[a1, c1, e1], [b1, d1, f1]] = outer;
  const [[a2, c2, e2], [b2, d2, f2]] = inner;
  return [
    [a1 * a2 + c1 * b2, a1 * c2 + c1 * d2, a1 * e2 + c1 * f2 + e1],
    [b1 * a2 + d1 * b2, b1 * c2 + d1 * d2, b1 * e2 + d1 * f2 + f1],
  ];
};

export const invert = (m: Affine): Affine | null => {
  const [[a, c, e], [b, d, f]] = m;
  const det = a * d - b * c;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  return [
    [d / det, -c / det, (c * f - d * e) / det],
    [-b / det, a / det, (b * e - a * f) / det],
  ];
};

const apply = (m: Affine, x: number, y: number): [number, number] => [
  m[0][0] * x + m[0][1] * y + m[0][2],
  m[1][0] * x + m[1][1] * y + m[1][2],
];

const translation = (x: number, y: number): Affine => [
  [1, 0, x],
  [0, 1, y],
];

/** A clockwise turn (y points down) of `deg` about (cx, cy) — SVG's and CSS's `rotate()`. */
const turnAbout = (deg: number, cx: number, cy: number): Affine => {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return compose(
    translation(cx, cy),
    compose(
      [
        [cos, -sin, 0],
        [sin, cos, 0],
      ],
      translation(-cx, -cy),
    ),
  );
};

const boxOf = (m: Affine, box: Box): Box => {
  const corners = [
    apply(m, box.minX, box.minY),
    apply(m, box.maxX, box.minY),
    apply(m, box.minX, box.maxY),
    apply(m, box.maxX, box.maxY),
  ];
  return {
    minX: Math.min(...corners.map(p => p[0])),
    minY: Math.min(...corners.map(p => p[1])),
    maxX: Math.max(...corners.map(p => p[0])),
    maxY: Math.max(...corners.map(p => p[1])),
  };
};

const union = (boxes: readonly Box[]): Box => ({
  minX: Math.min(...boxes.map(b => b.minX)),
  minY: Math.min(...boxes.map(b => b.minY)),
  maxX: Math.max(...boxes.map(b => b.maxX)),
  maxY: Math.max(...boxes.map(b => b.maxY)),
});

/** Copies a repeat group may spell out before its transforms stop being worth their bytes. */
export const MAX_REPEAT_TRANSFORMS = 100;

/** A repeat group's child as the serializer sees it: its size and where it sits on the canvas. */
export interface RepeatChild {
  width: number;
  height: number;
  absoluteTransform: Affine;
}

/**
 * Every copy of a repeat group's content after the original, as the CSS transform that draws it —
 * in the group's own coordinates (origin at its top-left, `transform-origin: 0 0`), in the order
 * Figma's SVG export lists them. `undefined` when there is nothing to repeat, when a modifier is
 * one this reader does not know, or past {@link MAX_REPEAT_TRANSFORMS} copies.
 *
 * The content is the union of the children's boxes. Each modifier repeats everything the previous
 * one produced: LINEAR moves copy k by k·step along its axis (step = offset px, or offset × the
 * content's width / height when RELATIVE); RADIAL turns copy k by k·360°/count clockwise about a
 * point straight below the content's centre, at offset/2 px from it (RELATIVE: offset × the
 * content's height / 2).
 */
export const repeatTransforms = (
  groupTransform: Affine,
  children: readonly RepeatChild[],
  modifiers: readonly SerializedTransformModifier[],
  axes?: Affine,
): string[] | undefined => {
  if (modifiers.length === 0 || children.length === 0) return undefined;
  const toGroup = invert(groupTransform);
  if (toGroup === null) return undefined;
  let content = union(
    children.map(child =>
      boxOf(compose(toGroup, child.absoluteTransform), {
        minX: 0,
        minY: 0,
        maxX: child.width,
        maxY: child.height,
      }),
    ),
  );
  let copies: Affine[] = [IDENTITY];
  for (const m of modifiers) {
    if (
      m.type !== 'REPEAT' ||
      typeof m.count !== 'number' ||
      typeof m.offset !== 'number' ||
      m.count < 1
    )
      return undefined;
    const steps: Affine[] = [];
    if (m.repeatType === 'LINEAR') {
      const horizontal = m.axis !== 'VERTICAL';
      const size = horizontal ? content.maxX - content.minX : content.maxY - content.minY;
      const step = m.unitType === 'RELATIVE' ? m.offset * size : m.offset;
      for (let k = 0; k < m.count; k += 1) {
        steps.push(horizontal ? translation(k * step, 0) : translation(0, k * step));
      }
      // What the next modifier sees grows with the copies only when they step forwards: copies
      // stepping backwards are drawn, but leave the content box (and the group's own) as it was
      // (measured — a following RELATIVE step or RADIAL centre comes from the original box).
      if (step > 0) {
        const reach = (m.count - 1) * step;
        content = horizontal
          ? { ...content, maxX: content.maxX + reach }
          : { ...content, maxY: content.maxY + reach };
      }
    } else if (m.repeatType === 'RADIAL') {
      const height = content.maxY - content.minY;
      const radius = (m.unitType === 'RELATIVE' ? m.offset * height : m.offset) / 2;
      const cx = (content.minX + content.maxX) / 2;
      const cy = (content.minY + content.maxY) / 2 + radius;
      for (let k = 0; k < m.count; k += 1) steps.push(turnAbout((k * 360) / m.count, cx, cy));
      // The next modifier sees the square around the whole circle the content's corners sweep, not
      // the union of the copies — its half-side the farthest corner's distance from the centre,
      // whatever the count (measured).
      const reach = Math.max(
        Math.hypot(content.minX - cx, content.minY - cy),
        Math.hypot(content.maxX - cx, content.minY - cy),
        Math.hypot(content.minX - cx, content.maxY - cy),
        Math.hypot(content.maxX - cx, content.maxY - cy),
      );
      content = { minX: cx - reach, minY: cy - reach, maxX: cx + reach, maxY: cy + reach };
    } else {
      return undefined;
    }
    const next: Affine[] = [];
    for (const outer of steps) for (const inner of copies) next.push(compose(outer, inner));
    copies = next;
    if (copies.length - 1 > MAX_REPEAT_TRANSFORMS) return undefined;
  }
  if (axes === undefined) return copies.slice(1).map(cssOf);
  // Each copy moved from the group's own axes into its parent's, about the group's origin — the
  // frame code draws in: the same box at the group's x / y, with no turn of its own.
  const back = invert(axes);
  if (back === null) return undefined;
  return copies.slice(1).map(copy => cssOf(compose(compose(axes, copy), back)));
};

const cssOf = (m: Affine): string => {
  const deg = round2((Math.atan2(m[1][0], m[0][0]) * 180) / Math.PI);
  const move = `translate(${round2(m[0][2])}px, ${round2(m[1][2])}px)`;
  return deg === 0 ? move : `${move} rotate(${deg}deg)`;
};

/** A repeat group's modifiers on the wire: Figma's own fields, unknown future kinds by type only. */
export const serializeTransformModifiers = (raw: unknown): SerializedTransformModifier[] => {
  if (!Array.isArray(raw)) return [];
  return raw.map((m: Record<string, unknown>) => {
    const out: SerializedTransformModifier = { type: String(m.type) };
    if (m.repeatType === 'LINEAR' || m.repeatType === 'RADIAL') out.repeatType = m.repeatType;
    if (m.axis === 'HORIZONTAL' || m.axis === 'VERTICAL') out.axis = m.axis;
    if (m.unitType === 'RELATIVE' || m.unitType === 'PIXELS') out.unitType = m.unitType;
    if (typeof m.offset === 'number') out.offset = round4(m.offset);
    if (typeof m.count === 'number') out.count = m.count;
    return out;
  });
};

const COMPLEX_FIELDS = [
  'brushType',
  'brushName',
  'direction',
  'gap',
  'wiggle',
  'sizeJitter',
  'angularJitter',
  'rotation',
  'frequency',
  'smoothen',
] as const;

/** A brush or dynamic stroke, or undefined for the plain BASIC kind (and anything unreadable). */
export const serializeComplexStroke = (raw: unknown): SerializedComplexStroke | undefined => {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  if (r.type !== 'BRUSH' && r.type !== 'DYNAMIC') return undefined;
  const out: Record<string, unknown> = { type: r.type };
  for (const field of COMPLEX_FIELDS) {
    const v = r[field];
    if (typeof v === 'number') out[field] = round4(v);
    else if (typeof v === 'string') out[field] = v;
  }
  return out as SerializedComplexStroke;
};

/** A width profile that varies along the stroke, or undefined for the uniform default. */
export const serializeVariableWidthStroke = (
  raw: unknown,
): SerializedVariableWidthStroke | undefined => {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const r = raw as { widthProfile?: unknown; variableWidthPoints?: unknown };
  if (typeof r.widthProfile !== 'string' || r.widthProfile === 'UNIFORM') return undefined;
  const points = Array.isArray(r.variableWidthPoints) ? r.variableWidthPoints : [];
  return {
    widthProfile: r.widthProfile,
    variableWidthPoints: points
      .filter(
        (p): p is { position: number; width: number } =>
          typeof p?.position === 'number' && typeof p?.width === 'number',
      )
      .map(p => ({ position: round4(p.position), width: round4(p.width) })),
  };
};

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The painted box, when it differs from the node's bounding box by half a pixel or more on any
 * side; undefined otherwise, or when Figma reports no render (a stroke that is all brush and no
 * paint). It is measured from the node's own x / y — its origin, in its parent's axes — which is
 * the bounding box's top-left unless the node is rotated or flipped, where the two part (9 px on a
 * brush stroke turned 9° in a published Figma Draw file): an export is already turned, so it goes
 * at x + renderBounds.x, y + renderBounds.y as it is. Figma's render bounds are cut by a clipping
 * ancestor (measured), and so is an export of the node, so the two still agree there.
 */
export const renderBoundsOf = (
  render: Rect | null | undefined,
  box: Rect | null | undefined,
  origin: { x: number; y: number } | undefined = box ?? undefined,
): SerializedBounds | undefined => {
  if (render == null || box == null || origin === undefined) return undefined;
  const dx = render.x - box.x;
  const dy = render.y - box.y;
  const dr = render.x + render.width - (box.x + box.width);
  const db = render.y + render.height - (box.y + box.height);
  if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dr), Math.abs(db)) < 0.5) return undefined;
  return {
    x: round2(render.x - origin.x),
    y: round2(render.y - origin.y),
    width: round2(render.width),
    height: round2(render.height),
  };
};

/** The fields a repeat group carries on the wire. */
export interface RepeatFields {
  transformModifiers?: readonly SerializedTransformModifier[] | undefined;
  repeatTransforms?: readonly string[] | undefined;
}

/** A repeat group's modifiers and the transform of each copy they make of its own children. */
export const applyRepeat = (node: TransformGroupNode, raw: unknown, out: RepeatFields): void => {
  const modifiers = serializeTransformModifiers(raw);
  if (modifiers.length === 0) return;
  out.transformModifiers = modifiers;
  // A turned or flipped group's copies are written in its parent's axes (see repeatTransforms).
  const [[a, c], [b, d]] = (node.relativeTransform as Transform | undefined) ?? [
    [1, 0, 0],
    [0, 1, 0],
  ];
  const upright = a === 1 && b === 0 && c === 0 && d === 1;
  const transforms = repeatTransforms(
    node.absoluteTransform,
    node.children,
    modifiers,
    upright
      ? undefined
      : [
          [a, c, 0],
          [b, d, 0],
        ],
  );
  if (transforms !== undefined && transforms.length > 0) out.repeatTransforms = transforms;
};
