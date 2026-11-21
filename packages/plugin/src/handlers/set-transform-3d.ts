import type { Transform3dWriteResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { readScene3d, readTransform3d } from '../transform3d.js';

/**
 * Write a node's 3D transform, the origin it turns about, and a frame / component / instance's 3D
 * scene (beta in the plugin API since typings 1.143). Measured on 2026-11-21:
 *
 * - Figma takes a whole `FIXED_ORDER` transform (all four numbers) and refuses NaN, Infinity, a
 *   missing or an extra key, and any `FREEFORM` one — which only an import makes. So each object
 *   here is merged with what the node holds: what the call leaves out stays as it is.
 * - `{ type: 'NONE' }` removes the transform and, with it, every 3D keyframe track on the node
 *   (Figma's undo brings them back); the result's `adjusted` names them.
 * - A scene of `{ perspective: -1, preserve3d: false }` is no scene: it reads back as none.
 * - An instance's layer can take each of these, and Figma never lists them in its overrides.
 * - None of it moves the node or its neighbours: the box and the layout stay as they are.
 */

const TOOL = 'set_transform_3d';
const NUMBERS = ['translateZ', 'rotateX', 'rotateY', 'rotateZ'] as const;

/** The keyframe fields that drive a 3D transform — the ones removing it deletes. */
export const TRANSFORM_3D_TRACKS: ReadonlySet<string> = new Set([
  'TRANSFORM_3D_TRANSLATION_Z',
  'TRANSFORM_3D_ROTATION_X',
  'TRANSFORM_3D_ROTATION_Y',
  'TRANSFORM_3D_ROTATION_Z',
]);

/** The node's 3D keyframe tracks, by field name (none where Motion is unavailable). */
export const transform3dTracksOf = (node: BaseNode): string[] => {
  if (!('manualKeyframeTracks' in node)) return [];
  try {
    const tracks = (node as unknown as { manualKeyframeTracks: Record<string, unknown> })
      .manualKeyframeTracks;
    return Object.keys(tracks).filter(name => TRANSFORM_3D_TRACKS.has(name));
  } catch {
    return [];
  }
};

type Bag = Record<string, unknown>;

const isFinite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const objectArg = (value: unknown, name: string): Bag => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${TOOL}: ${name} must be an object`);
  }
  return value as Bag;
};

const onlyKeys = (value: Bag, name: string, allowed: readonly string[]): void => {
  const extra = Object.keys(value).filter(k => !allowed.includes(k) && value[k] !== undefined);
  if (extra.length > 0) {
    throw new TypeError(`${TOOL}: ${name} takes no ${extra.join(', ')}`);
  }
};

const booleanOrUndefined = (value: unknown, name: string): boolean | undefined => {
  if (value !== undefined && typeof value !== 'boolean') {
    throw new TypeError(`${TOOL}: ${name} must be a boolean`);
  }
  return value;
};

/**
 * The transform the call asks for, merged with the one the node holds: a number left out keeps its
 * value (0 when the node had none), and so does a flag. An imported FREEFORM transform has no
 * numbers to keep, so replacing one takes all four.
 */
export const nextTransform3d = (current: Transform3d, raw: unknown): Transform3d => {
  const asked = objectArg(raw, 'transform3d');
  onlyKeys(asked, 'transform3d', ['type', ...NUMBERS, 'backfaceVisible', 'visible']);
  if (asked.type !== undefined && asked.type !== 'FIXED_ORDER' && asked.type !== 'NONE') {
    throw new TypeError(
      `${TOOL}: transform3d.type must be FIXED_ORDER or NONE — a FREEFORM transform only comes ` +
        'from an import',
    );
  }
  if (asked.type === 'NONE') {
    const extra = Object.keys(asked).filter(k => k !== 'type' && asked[k] !== undefined);
    if (extra.length > 0) {
      throw new TypeError(`${TOOL}: a NONE transform takes no ${extra.join(', ')}`);
    }
    return { type: 'NONE' };
  }
  for (const key of NUMBERS) {
    if (asked[key] !== undefined && !isFinite(asked[key])) {
      throw new TypeError(`${TOOL}: transform3d.${key} must be a finite number`);
    }
  }
  const backfaceVisible = booleanOrUndefined(asked.backfaceVisible, 'transform3d.backfaceVisible');
  const visible = booleanOrUndefined(asked.visible, 'transform3d.visible');
  if (current.type === 'FREEFORM') {
    const missing = NUMBERS.filter(key => asked[key] === undefined);
    if (missing.length > 0) {
      throw new TypeError(
        `${TOOL}: the node's transform is an imported FREEFORM one, which has no ${missing.join(', ')}` +
          ' to keep — give all four of translateZ, rotateX, rotateY and rotateZ to replace it',
      );
    }
  }
  const base = current.type === 'FIXED_ORDER' ? current : null;
  const out: Bag = { type: 'FIXED_ORDER' };
  for (const key of NUMBERS) out[key] = (asked[key] as number | undefined) ?? base?.[key] ?? 0;
  const keptBackface =
    backfaceVisible ?? (current.type === 'NONE' ? undefined : current.backfaceVisible);
  const keptVisible = visible ?? (current.type === 'NONE' ? undefined : current.visible);
  if (keptBackface !== undefined) out.backfaceVisible = keptBackface;
  if (keptVisible !== undefined) out.visible = keptVisible;
  return out as unknown as Transform3d;
};

const axisArg = (raw: unknown, name: string): TransformOriginAxis => {
  const axis = objectArg(raw, name);
  onlyKeys(axis, name, ['unit', 'value']);
  if (axis.unit !== 'PERCENT' && axis.unit !== 'PIXELS') {
    throw new TypeError(`${TOOL}: ${name}.unit must be PERCENT or PIXELS`);
  }
  if (!isFinite(axis.value)) throw new TypeError(`${TOOL}: ${name}.value must be a finite number`);
  return { unit: axis.unit, value: axis.value };
};

/** The origin the call asks for: an axis left out keeps its own. */
export const nextTransformOrigin = (current: TransformOrigin, raw: unknown): TransformOrigin => {
  const asked = objectArg(raw, 'transformOrigin');
  onlyKeys(asked, 'transformOrigin', ['x', 'y']);
  if (asked.x === undefined && asked.y === undefined) {
    throw new TypeError(`${TOOL}: transformOrigin needs x, y or both`);
  }
  return {
    x: asked.x === undefined ? current.x : axisArg(asked.x, 'transformOrigin.x'),
    y: asked.y === undefined ? current.y : axisArg(asked.y, 'transformOrigin.y'),
  };
};

/**
 * The scene the call asks for: `null` clears it (and opts an instance out of the one it would
 * inherit); an object is merged with the scene the node has, or with no scene's values (perspective
 * -1, preserve3d false) when it has none.
 */
export const nextScene3d = (current: Scene3d | null, raw: unknown): Scene3d | null => {
  if (raw === null) return null;
  const asked = objectArg(raw, 'scene3d');
  onlyKeys(asked, 'scene3d', ['perspective', 'preserve3d', 'visible']);
  if (asked.perspective !== undefined && !isFinite(asked.perspective)) {
    throw new TypeError(`${TOOL}: scene3d.perspective must be a finite number`);
  }
  const preserve3d = booleanOrUndefined(asked.preserve3d, 'scene3d.preserve3d');
  const visible = booleanOrUndefined(asked.visible, 'scene3d.visible') ?? current?.visible;
  const out: { perspective: number; preserve3d: boolean; visible?: boolean } = {
    perspective: (asked.perspective as number | undefined) ?? current?.perspective ?? -1,
    preserve3d: preserve3d ?? current?.preserve3d ?? false,
  };
  if (visible !== undefined) out.visible = visible;
  return out;
};

export const createSetTransform3dHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as {
      nodeId?: unknown;
      transform3d?: unknown;
      transformOrigin?: unknown;
      scene3d?: unknown;
    };
    if (typeof p.nodeId !== 'string') throw new TypeError(`${TOOL}: nodeId must be a string`);
    if (p.transform3d === undefined && p.transformOrigin === undefined && p.scene3d === undefined) {
      throw new TypeError(`${TOOL}: give transform3d, transformOrigin, scene3d or any of them`);
    }
    const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
    if (node === null) throw new Error(`${TOOL}: node ${p.nodeId} not found`);
    const turns = 'transform3d' in node;
    if ((p.transform3d !== undefined || p.transformOrigin !== undefined) && !turns) {
      throw new Error(
        `${TOOL}: node ${p.nodeId} (${node.type}) takes no 3D transform — a page, a section, a ` +
          'sticky, a connector and a shape with text take none, and nothing does in a Figma ' +
          'build from before 3D transforms',
      );
    }
    if (p.scene3d !== undefined && !('scene3d' in node)) {
      throw new Error(
        `${TOOL}: node ${p.nodeId} (${node.type}) cannot hold a 3D scene — only a frame, a ` +
          'component or an instance can',
      );
    }
    const target = node as unknown as {
      transform3d: Transform3d;
      transformOrigin: TransformOrigin;
      scene3d: Scene3d | null;
    };
    // Everything is worked out, and refused, before anything is written.
    const transform =
      p.transform3d === undefined ? undefined : nextTransform3d(target.transform3d, p.transform3d);
    const origin =
      p.transformOrigin === undefined
        ? undefined
        : nextTransformOrigin(target.transformOrigin, p.transformOrigin);
    const scene = p.scene3d === undefined ? undefined : nextScene3d(target.scene3d, p.scene3d);
    const dropped =
      transform?.type === 'NONE' && target.transform3d.type !== 'NONE'
        ? transform3dTracksOf(node)
        : [];

    if (origin !== undefined) target.transformOrigin = origin;
    if (transform !== undefined) target.transform3d = transform;
    if (scene !== undefined) target.scene3d = scene;

    const adjusted: string[] = [];
    if (dropped.length > 0) {
      adjusted.push(
        `removing the 3D transform also removed its keyframe tracks ${dropped.join(', ')} ` +
          "(Figma's undo brings them back)",
      );
    }
    if (scene !== null && scene !== undefined && target.scene3d === null) {
      adjusted.push(
        'a scene with perspective -1 and preserve3d false is no scene: it reads back as none',
      );
    }
    const read = readTransform3d(node as SceneNode);
    const result: Transform3dWriteResult = { ok: true, nodeId: node.id, ...read };
    const sceneNow = readScene3d(node as SceneNode);
    if (sceneNow !== undefined) result.scene3d = sceneNow;
    if (adjusted.length > 0) result.adjusted = adjusted.join('; ');
    return result;
  };

/** What a 3D keyframe track drives on the node: its transform, its scene, or neither. */
export const keyframeDepthOf = (field: unknown): 'transform3d' | 'scene3d' | null => {
  const f = field as { type?: unknown; name?: unknown } | null;
  if (f?.type !== 'PROPERTY' || typeof f.name !== 'string') return null;
  if (TRANSFORM_3D_TRACKS.has(f.name)) return 'transform3d';
  return f.name === 'SCENE_3D_PERSPECTIVE' ? 'scene3d' : null;
};

/**
 * Refuse a 3D track on a node it can never move: Figma takes SCENE_3D_PERSPECTIVE on a rectangle
 * and keeps it, and it never draws (measured) — only a frame, component or instance holds a scene.
 */
export const assertKeyframeDepthTarget = (node: BaseNode, field: unknown, tool: string): void => {
  const drives = keyframeDepthOf(field);
  if (drives === 'scene3d' && !('scene3d' in node)) {
    throw new Error(
      `${tool}: SCENE_3D_PERSPECTIVE animates a 3D scene, which only a frame, a component or an ` +
        `instance holds — node ${node.id} (${node.type}) has none, so the track would never draw`,
    );
  }
  if (drives === 'transform3d' && !('transform3d' in node)) {
    throw new Error(`${tool}: node ${node.id} (${node.type}) takes no 3D transform to animate`);
  }
};

/**
 * What applying a 3D track changed beyond the track, as `adjusted` says it (measured): a node with
 * no transform is given one (FIXED_ORDER, all 0) for the track to drive; a frame with no scene is
 * given one when the track brings a baseValue; and a baseValue is the field's static value, so it
 * rewrites the transform's number or the scene's perspective.
 */
/** Float32 noise left out of what a note says (30 reads back 30.000000834826057). */
const round = (v: number): number => Math.round(v * 10_000) / 10_000;

export const keyframeDepthAdjusted = (
  node: BaseNode,
  field: unknown,
  before: Transform3d | Scene3d | null,
): string | undefined => {
  const drives = keyframeDepthOf(field);
  const bag = node as unknown as Bag;
  const name = (field as { name: string }).name;
  if (drives === 'transform3d') {
    const was = before as Transform3d;
    const now = bag.transform3d as Transform3d;
    if (now.type !== 'FIXED_ORDER') return undefined;
    if (was.type === 'NONE') {
      return 'the node had no 3D transform, so Figma gave it one for the track to drive (FIXED_ORDER, all 0)';
    }
    const key = TRACK_NUMBER[name]!;
    if (was.type === 'FIXED_ORDER' && round(was[key]) !== round(now[key])) {
      return `the track's baseValue is the transform's own ${key}, which it changed from ${round(was[key])} to ${round(now[key])}`;
    }
    return undefined;
  }
  if (drives === 'scene3d') {
    const was = before as Scene3d | null;
    const now = bag.scene3d as Scene3d | null;
    if (was === null && now !== null) {
      return `the frame had no 3D scene, so Figma made one from the track's baseValue (perspective ${round(now.perspective)}, preserve3d false)`;
    }
    if (was !== null && now !== null && round(was.perspective) !== round(now.perspective)) {
      return `the track's baseValue is the scene's own perspective, which it changed from ${round(was.perspective)} to ${round(now.perspective)}`;
    }
  }
  return undefined;
};

const TRACK_NUMBER: Readonly<Record<string, (typeof NUMBERS)[number]>> = {
  TRANSFORM_3D_TRANSLATION_Z: 'translateZ',
  TRANSFORM_3D_ROTATION_X: 'rotateX',
  TRANSFORM_3D_ROTATION_Y: 'rotateY',
  TRANSFORM_3D_ROTATION_Z: 'rotateZ',
};
