import { describe, expect, it, vi } from 'vitest';

import { createApplyManualKeyframeTrackHandler } from '../../src/handlers/apply-manual-keyframe-track.js';
import { createBatchHandler } from '../../src/handlers/batch.js';
import { createSetFillsHandler } from '../../src/handlers/set-fills.js';
import { createSetTransform3dHandler } from '../../src/handlers/set-transform-3d.js';

type Bag = Record<string, unknown>;
type Fixed = {
  type: 'FIXED_ORDER';
  translateZ: number;
  rotateX: number;
  rotateY: number;
  rotateZ: number;
  backfaceVisible?: boolean;
  visible?: boolean;
};
type Track = { baseValue?: { type: 'FLOAT'; value: number }; keyframes: unknown[] };

const NUMBER_OF: Record<string, keyof Fixed> = {
  TRANSFORM_3D_TRANSLATION_Z: 'translateZ',
  TRANSFORM_3D_ROTATION_X: 'rotateX',
  TRANSFORM_3D_ROTATION_Y: 'rotateY',
  TRANSFORM_3D_ROTATION_Z: 'rotateZ',
};

/**
 * A node that behaves like Figma's where these tools depend on it (each measured 2026-11-21): a
 * FIXED_ORDER transform needs all four numbers and a FREEFORM one cannot be assigned; reads report
 * backfaceVisible / visible as true when unset; removing the transform deletes its 3D tracks; a 3D
 * track's baseValue is the transform's (or scene's) own value, both ways; a track on a node with no
 * transform turns one on (all 0); a perspective baseValue on a frame with no scene makes one; and a
 * scene of perspective -1 without preserve3d is none.
 */
const depthNode = (
  id: string,
  init: {
    type?: string;
    transform3d?: Bag;
    scene3d?: Bag | null;
    scenes?: boolean;
    tracks?: Record<string, Track>;
  } = {},
) => {
  let transform: Bag = init.transform3d ?? { type: 'NONE' };
  let origin: Bag = { x: { unit: 'PERCENT', value: 50 }, y: { unit: 'PERCENT', value: 50 } };
  let scene: Bag | null = init.scene3d ?? null;
  const tracks: Record<string, Track> = { ...init.tracks };
  const node: Bag = {
    id,
    type: init.type ?? (init.scenes === false ? 'RECTANGLE' : 'FRAME'),
    parent: null,
    width: 100,
    height: 50,
    relativeTransform: [
      [1, 0, 0],
      [0, 1, 0],
    ],
    animationStyles: [],
    applyAnimationStyle: () => '',
    get manualKeyframeTracks() {
      return tracks;
    },
    get transform3d() {
      return transform.type === 'FIXED_ORDER'
        ? { backfaceVisible: true, visible: true, ...transform }
        : { ...transform };
    },
    set transform3d(v: Bag) {
      if (v.type === 'FREEFORM') throw new Error('Expected .type to be one of NONE, FIXED_ORDER');
      if (
        v.type === 'FIXED_ORDER' &&
        ['translateZ', 'rotateX', 'rotateY', 'rotateZ'].some(k => typeof v[k] !== 'number')
      ) {
        throw new Error('Required value missing');
      }
      transform = { ...v };
      for (const [name, key] of Object.entries(NUMBER_OF)) {
        if (tracks[name] === undefined) continue;
        if (v.type === 'NONE') delete tracks[name];
        else
          tracks[name] = { ...tracks[name], baseValue: { type: 'FLOAT', value: v[key] as number } };
      }
    },
    get transformOrigin() {
      return origin;
    },
    set transformOrigin(v: Bag) {
      origin = v;
    },
    applyManualKeyframeTrack: vi.fn<(field: { name: string }, track: Track) => void>(
      (field, track) => {
        const key = NUMBER_OF[field.name];
        if (key !== undefined) {
          if (transform.type === 'NONE') {
            transform = { type: 'FIXED_ORDER', translateZ: 0, rotateX: 0, rotateY: 0, rotateZ: 0 };
          }
          if (track.baseValue !== undefined) transform[key] = track.baseValue.value;
          tracks[field.name] = {
            ...track,
            baseValue: { type: 'FLOAT', value: transform[key] as number },
          };
        } else if (field.name === 'SCENE_3D_PERSPECTIVE') {
          if (track.baseValue !== undefined) {
            scene =
              scene === null
                ? { perspective: track.baseValue.value, preserve3d: false, visible: true }
                : { ...scene, perspective: track.baseValue.value };
          }
          tracks[field.name] = {
            ...track,
            baseValue: { type: 'FLOAT', value: (scene?.perspective as number | undefined) ?? -1 },
          };
        } else {
          tracks[field.name] = track;
        }
      },
    ),
    removeManualKeyframeTrack: vi.fn<(field: { name: string }) => void>(field => {
      delete tracks[field.name];
    }),
  };
  if (init.scenes !== false) {
    Object.defineProperty(node, 'scene3d', {
      enumerable: true,
      get: () => scene,
      set: (v: Bag | null) => {
        scene =
          v === null || (v.perspective === -1 && v.preserve3d === false && v.visible !== false)
            ? null
            : { ...v, visible: v.visible ?? true }; // read back in Figma's order
        const track = tracks.SCENE_3D_PERSPECTIVE;
        if (track !== undefined) {
          track.baseValue = {
            type: 'FLOAT',
            value: (scene?.perspective as number | undefined) ?? -1,
          };
        }
      },
    });
  }
  return node;
};

const ctxOf = (...nodes: Bag[]) => {
  const store = new Map<string, Bag>(nodes.map(n => [n.id as string, n]));
  store.set('F', { id: 'F', type: 'RECTANGLE', fills: [] });
  const figmaCtx = {
    editorType: 'figma',
    mixed: Symbol('mixed'),
    root: { children: [] },
    getNodeByIdAsync: async (id: string) => store.get(id) ?? null,
    variables: { getVariableByIdAsync: async () => null },
  } as unknown as typeof figma;
  return { figmaCtx, store };
};

const FIXED = (rotateY: number, extra: Bag = {}): Bag => ({
  type: 'FIXED_ORDER',
  translateZ: 0,
  rotateX: 0,
  rotateY,
  rotateZ: 0,
  ...extra,
});

const run = async (node: Bag, args: Bag) => {
  const { figmaCtx } = ctxOf(node);
  return createSetTransform3dHandler(figmaCtx)({ nodeId: node.id, ...args });
};

describe('set_transform_3d', () => {
  it('keeps every field of the transform the call leaves out, flags included', async () => {
    const node = depthNode('1:1', {
      transform3d: FIXED(30, { translateZ: 12, backfaceVisible: false }),
    });

    const result = await run(node, { transform3d: { rotateX: 15 } });

    expect(node.transform3d).toEqual({
      type: 'FIXED_ORDER',
      translateZ: 12,
      rotateX: 15,
      rotateY: 30,
      rotateZ: 0,
      backfaceVisible: false,
      visible: true,
    });
    expect(result).toMatchObject({
      ok: true,
      nodeId: '1:1',
      transform3d: { type: 'FIXED_ORDER', rotateX: 15, rotateY: 30, backfaceVisible: false },
    });
  });

  it('turns on a transform from nothing, the numbers it leaves out at 0', async () => {
    const node = depthNode('1:1');
    const result = await run(node, { transform3d: { rotateY: 45 } });
    expect(node.transform3d).toMatchObject({ ...FIXED(45) });
    expect(result).toMatchObject({ cssTransform3d: expect.stringContaining('rotateY(45deg)') });
  });

  it('removes a transform, names the keyframe tracks that went with it, and reads back none', async () => {
    const node = depthNode('1:1', {
      transform3d: FIXED(30),
      tracks: {
        TRANSFORM_3D_ROTATION_Y: { keyframes: [] },
        OPACITY: { keyframes: [] },
      },
    });

    const result = (await run(node, { transform3d: { type: 'NONE' } })) as Bag;

    expect(node.transform3d).toEqual({ type: 'NONE' });
    expect(Object.keys(node.manualKeyframeTracks as Bag)).toEqual(['OPACITY']);
    expect(result.transform3d).toBeUndefined();
    expect(result.adjusted).toMatch(/keyframe tracks TRANSFORM_3D_ROTATION_Y/);
  });

  it('refuses a NONE transform given anything else, and a FREEFORM one', async () => {
    const node = depthNode('1:1');
    await expect(run(node, { transform3d: { type: 'NONE', rotateY: 3 } })).rejects.toThrow(
      /a NONE transform takes no rotateY/,
    );
    await expect(run(node, { transform3d: { type: 'FREEFORM' } })).rejects.toThrow(
      /FREEFORM transform only comes from an import/,
    );
  });

  it('replaces an imported FREEFORM transform only when given all four numbers, keeping its flags', async () => {
    const node = depthNode('1:1', {
      transform3d: { type: 'FREEFORM', backfaceVisible: false, visible: true },
    });
    await expect(run(node, { transform3d: { rotateY: 5 } })).rejects.toThrow(
      /imported FREEFORM one, which has no translateZ, rotateX, rotateZ to keep/,
    );
    expect(node.transform3d).toMatchObject({ type: 'FREEFORM' });

    await run(node, { transform3d: { translateZ: 0, rotateX: 1, rotateY: 2, rotateZ: 3 } });
    expect(node.transform3d).toEqual({
      type: 'FIXED_ORDER',
      translateZ: 0,
      rotateX: 1,
      rotateY: 2,
      rotateZ: 3,
      backfaceVisible: false,
      visible: true,
    });
  });

  it('refuses what Figma would, before writing anything', async () => {
    const node = depthNode('1:1', { transform3d: FIXED(30) });
    for (const [args, message] of [
      [{ transform3d: { rotateY: Number.NaN } }, /rotateY must be a finite number/],
      [{ transform3d: { rotateY: 1, foo: 2 } }, /transform3d takes no foo/],
      [{ transform3d: { visible: 'yes' } }, /transform3d.visible must be a boolean/],
      [{ transformOrigin: {} }, /transformOrigin needs x, y or both/],
      [{ transformOrigin: { x: { unit: 'EM', value: 1 } } }, /x.unit must be PERCENT or PIXELS/],
      [{ scene3d: { perspective: Infinity } }, /perspective must be a finite number/],
      // The transform is valid; the scene in the same call is not, so neither is written.
      [
        { transform3d: { rotateY: 60 }, scene3d: { preserve3d: 1 } },
        /preserve3d must be a boolean/,
      ],
    ] as const) {
      // eslint-disable-next-line no-await-in-loop -- each case on the same node, in turn
      await expect(run(node, args as Bag)).rejects.toThrow(message);
    }
    expect(node.transform3d).toMatchObject({ rotateY: 30 });
  });

  it('moves one axis of the origin and keeps the other', async () => {
    const node = depthNode('1:1', { transform3d: FIXED(30) });
    const result = await run(node, { transformOrigin: { x: { unit: 'PIXELS', value: 0 } } });
    expect(node.transformOrigin).toEqual({
      x: { unit: 'PIXELS', value: 0 },
      y: { unit: 'PERCENT', value: 50 },
    });
    expect(result).toMatchObject({
      transformOrigin: { x: { unit: 'PIXELS', value: 0 }, y: { unit: 'PERCENT', value: 50 } },
    });
  });

  it('keeps the x of an origin when the call moves only y', async () => {
    const node = depthNode('1:1', { transform3d: FIXED(30) });
    await run(node, { transformOrigin: { x: { unit: 'PIXELS', value: 7 } } });
    await run(node, { transformOrigin: { y: { unit: 'PIXELS', value: 3 } } });
    expect(node.transformOrigin).toEqual({
      x: { unit: 'PIXELS', value: 7 },
      y: { unit: 'PIXELS', value: 3 },
    });
  });

  it('keeps a scene’s perspective when the call changes only preserve3d', async () => {
    const node = depthNode('1:1', {
      scene3d: { perspective: 500, preserve3d: true, visible: true },
    });
    await run(node, { scene3d: { preserve3d: false } });
    expect(node.scene3d).toEqual({ perspective: 500, preserve3d: false, visible: true });
  });

  it('merges a scene with the one there, clears it with null, and says when one is no scene', async () => {
    const node = depthNode('1:1', {
      scene3d: { perspective: 500, preserve3d: true, visible: false },
    });

    await run(node, { scene3d: { perspective: 800 } });
    expect(node.scene3d).toEqual({ perspective: 800, preserve3d: true, visible: false });

    expect(await run(node, { scene3d: null })).not.toHaveProperty('scene3d');
    expect(node.scene3d).toBeNull();

    const fresh = (await run(node, { scene3d: { preserve3d: true } })) as Bag;
    expect(node.scene3d).toEqual({ perspective: -1, preserve3d: true, visible: true });
    expect(fresh.scene3d).toEqual({ perspective: -1, preserve3d: true });

    const none = (await run(node, { scene3d: { preserve3d: false } })) as Bag;
    expect(node.scene3d).toBeNull();
    expect(none.adjusted).toMatch(/perspective -1 and preserve3d false is no scene/);
  });

  it('refuses a node that cannot take what the call asks for', async () => {
    const rect = depthNode('1:1', { scenes: false });
    await expect(run(rect, { scene3d: { perspective: 300 } })).rejects.toThrow(
      /RECTANGLE\) cannot hold a 3D scene — only a frame, a component or an instance can/,
    );
    const page = { id: '0:1', type: 'PAGE' };
    await expect(run(page, { transform3d: { rotateY: 3 } })).rejects.toThrow(
      /\(PAGE\) takes no 3D transform/,
    );
    await expect(run(rect, {})).rejects.toThrow(/give transform3d, transformOrigin, scene3d/);
    const { figmaCtx } = ctxOf();
    await expect(
      createSetTransform3dHandler(figmaCtx)({ nodeId: '9:9', transform3d: { rotateY: 1 } }),
    ).rejects.toThrow(/node 9:9 not found/);
  });
});

describe('3D keyframe tracks', () => {
  const kf = { keyframes: [{ timelinePosition: 0, value: { type: 'FLOAT', value: 0 } }] };
  const apply = async (node: Bag, name: string, track: Bag = kf) => {
    const { figmaCtx } = ctxOf(node);
    return createApplyManualKeyframeTrackHandler(figmaCtx)({
      nodeId: node.id,
      field: { type: 'PROPERTY', name },
      track,
    }) as Promise<Bag>;
  };

  it('refuses a perspective track on a node that holds no scene, where it would never draw', async () => {
    const rect = depthNode('1:1', { scenes: false });
    await expect(apply(rect, 'SCENE_3D_PERSPECTIVE')).rejects.toThrow(
      /SCENE_3D_PERSPECTIVE animates a 3D scene, which only a frame, a component or an instance holds — node 1:1 \(RECTANGLE\) has none/,
    );
    expect(rect.applyManualKeyframeTrack).not.toHaveBeenCalled();
  });

  it('says when the track turned a transform on, or rewrote the value its baseValue is', async () => {
    const node = depthNode('1:1');
    expect((await apply(node, 'TRANSFORM_3D_ROTATION_Y')).adjusted).toMatch(
      /had no 3D transform, so Figma gave it one/,
    );
    const turned = depthNode('1:2', { transform3d: FIXED(10) });
    expect(
      (
        await apply(turned, 'TRANSFORM_3D_ROTATION_Y', {
          ...kf,
          baseValue: { type: 'FLOAT', value: 45 },
        })
      ).adjusted,
    ).toBe("the track's baseValue is the transform's own rotateY, which it changed from 10 to 45");
  });

  it('says when a perspective track made a scene, or rewrote its perspective', async () => {
    const frame = depthNode('1:1');
    const base = { ...kf, baseValue: { type: 'FLOAT', value: 300 } };
    expect((await apply(frame, 'SCENE_3D_PERSPECTIVE', base)).adjusted).toMatch(
      /had no 3D scene, so Figma made one from the track's baseValue \(perspective 300/,
    );
    expect(
      (
        await apply(frame, 'SCENE_3D_PERSPECTIVE', {
          ...kf,
          baseValue: { type: 'FLOAT', value: 450 },
        })
      ).adjusted,
    ).toBe(
      "the track's baseValue is the scene's own perspective, which it changed from 300 to 450",
    );
  });

  it('says nothing for a track that changed nothing else, 3D or not', async () => {
    const turned = depthNode('1:1', { transform3d: FIXED(10) });
    expect(await apply(turned, 'TRANSFORM_3D_ROTATION_Y')).toEqual({ ok: true, nodeId: '1:1' });
    expect(await apply(turned, 'OPACITY')).toEqual({ ok: true, nodeId: '1:1' });
  });
});

describe('batch rollback of 3D writes', () => {
  const FAIL = { tool: 'set_fills', params: { nodeId: 'F', fills: [{ type: 'GRADIENT_LINEAR' }] } };
  const batchOf = (...nodes: Bag[]) => {
    const { figmaCtx } = ctxOf(...nodes);
    return createBatchHandler(figmaCtx, {
      set_transform_3d: createSetTransform3dHandler(figmaCtx),
      apply_manual_keyframe_track: createApplyManualKeyframeTrackHandler(figmaCtx),
      set_fills: createSetFillsHandler(figmaCtx),
    });
  };

  it('puts the transform, the origin and the scene back', async () => {
    const node = depthNode('1:1', {
      transform3d: FIXED(30),
      scene3d: { perspective: 500, preserve3d: true, visible: true },
    });
    const before = JSON.stringify([node.transform3d, node.transformOrigin, node.scene3d]);
    await expect(
      batchOf(node)({
        ops: [
          {
            tool: 'set_transform_3d',
            params: {
              nodeId: '1:1',
              transform3d: { rotateX: 9 },
              transformOrigin: { x: { unit: 'PIXELS', value: 0 } },
              scene3d: null,
            },
          },
          FAIL,
        ],
      }),
    ).rejects.toThrow(/rolled back 1 applied op\(s\): GRADIENT_LINEAR/);
    expect(JSON.stringify([node.transform3d, node.transformOrigin, node.scene3d])).toBe(before);
  });

  it('refuses to remove a transform carrying 3D keyframe tracks, which a rollback could not bring back', async () => {
    const node = depthNode('1:1', {
      transform3d: FIXED(30),
      tracks: { TRANSFORM_3D_ROTATION_Y: { keyframes: [] } },
    });
    await expect(
      batchOf(node)({
        ops: [
          { tool: 'set_transform_3d', params: { nodeId: '1:1', transform3d: { type: 'NONE' } } },
        ],
      }),
    ).rejects.toThrow(/also deletes its keyframe tracks TRANSFORM_3D_ROTATION_Y/);
    expect(node.transform3d).toMatchObject({ rotateY: 30 });
  });

  it('removes a transform with no 3D tracks, and puts it back on rollback', async () => {
    const node = depthNode('1:1', { transform3d: FIXED(30) });
    await expect(
      batchOf(node)({
        ops: [
          { tool: 'set_transform_3d', params: { nodeId: '1:1', transform3d: { type: 'NONE' } } },
          FAIL,
        ],
      }),
    ).rejects.toThrow(/rolled back 1/);
    expect(node.transform3d).toMatchObject({ type: 'FIXED_ORDER', rotateY: 30 });
  });

  it('refuses to replace an imported FREEFORM transform, which cannot be set back', async () => {
    const node = depthNode('1:1', { transform3d: { type: 'FREEFORM', backfaceVisible: true } });
    await expect(
      batchOf(node)({
        ops: [
          {
            tool: 'set_transform_3d',
            params: {
              nodeId: '1:1',
              transform3d: { translateZ: 0, rotateX: 0, rotateY: 0, rotateZ: 0 },
            },
          },
        ],
      }),
    ).rejects.toThrow(/imported FREEFORM transform, which the plugin API cannot set back/);
  });

  it('turns a transform the track turned on back off', async () => {
    const node = depthNode('1:1');
    await expect(
      batchOf(node)({
        ops: [
          {
            tool: 'apply_manual_keyframe_track',
            params: {
              nodeId: '1:1',
              field: { type: 'PROPERTY', name: 'TRANSFORM_3D_ROTATION_Y' },
              track: { keyframes: [{ timelinePosition: 0, value: { type: 'FLOAT', value: 90 } }] },
            },
          },
          FAIL,
        ],
      }),
    ).rejects.toThrow(/rolled back 1 applied op\(s\): GRADIENT_LINEAR/);
    expect(node.transform3d).toEqual({ type: 'NONE' });
    expect(node.manualKeyframeTracks).toEqual({});
  });

  it('puts back the value a baseValue rewrote, and the scene a perspective track made', async () => {
    const turned = depthNode('1:1', { transform3d: FIXED(10) });
    const frame = depthNode('1:2');
    const track = (value: number) => ({
      baseValue: { type: 'FLOAT', value },
      keyframes: [{ timelinePosition: 0, value: { type: 'FLOAT', value: 0 } }],
    });
    await expect(
      batchOf(
        turned,
        frame,
      )({
        ops: [
          {
            tool: 'apply_manual_keyframe_track',
            params: {
              nodeId: '1:1',
              field: { type: 'PROPERTY', name: 'TRANSFORM_3D_ROTATION_Y' },
              track: track(45),
            },
          },
          {
            tool: 'apply_manual_keyframe_track',
            params: {
              nodeId: '1:2',
              field: { type: 'PROPERTY', name: 'SCENE_3D_PERSPECTIVE' },
              track: track(300),
            },
          },
          FAIL,
        ],
      }),
    ).rejects.toThrow(/rolled back 2/);
    expect(turned.transform3d).toMatchObject({ rotateY: 10 });
    expect(turned.manualKeyframeTracks).toEqual({});
    expect(frame.scene3d).toBeNull();
    expect(frame.manualKeyframeTracks).toEqual({});
  });

  it('refuses a perspective track on a node with no scene before anything runs', async () => {
    const rect = depthNode('1:1', { scenes: false });
    await expect(
      batchOf(rect)({
        ops: [
          {
            tool: 'apply_manual_keyframe_track',
            params: {
              nodeId: '1:1',
              field: { type: 'PROPERTY', name: 'SCENE_3D_PERSPECTIVE' },
              track: { keyframes: [{ timelinePosition: 0, value: { type: 'FLOAT', value: 1 } }] },
            },
          },
        ],
      }),
    ).rejects.toThrow(
      /batch\/apply_manual_keyframe_track: SCENE_3D_PERSPECTIVE animates a 3D scene/,
    );
    expect(rect.applyManualKeyframeTrack).not.toHaveBeenCalled();
  });
});
