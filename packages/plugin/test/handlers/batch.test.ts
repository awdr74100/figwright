import type { BatchResult } from '@figwright/shared';
import { describe, expect, it, vi } from 'vitest';

import type { SandboxHandlers } from '../../src/dispatcher.js';
import { createApplyAnimationStyleHandler } from '../../src/handlers/apply-animation-style.js';
import { createApplyManualKeyframeTrackHandler } from '../../src/handlers/apply-manual-keyframe-track.js';
import { createBatchHandler } from '../../src/handlers/batch.js';
import { createCreateComponentHandler } from '../../src/handlers/create-component.js';
import { createCreateFrameHandler } from '../../src/handlers/create-frame.js';
import { createDeleteNodesHandler } from '../../src/handlers/delete-nodes.js';
import { createMoveNodesHandler } from '../../src/handlers/move-nodes.js';
import { createRenameNodeHandler } from '../../src/handlers/rename-node.js';
import { createSetCornerRadiusHandler } from '../../src/handlers/set-corner-radius.js';
import { createSetFillsHandler } from '../../src/handlers/set-fills.js';
import { createSetOpacityHandler } from '../../src/handlers/set-opacity.js';
import { createSetStrokesHandler } from '../../src/handlers/set-strokes.js';
import { createSetTextPropertiesHandler } from '../../src/handlers/set-text-properties.js';
import { createSetTimelineDurationHandler } from '../../src/handlers/set-timeline-duration.js';
import { createIdempotencyCache, idempotent } from '../../src/idempotency.js';

/** A mutable node store backing a fake figma whose getNodeByIdAsync / createFrame share one map. */
const makeFigma = (initial: Record<string, Record<string, unknown>>) => {
  const store = new Map<string, Record<string, unknown>>(Object.entries(initial));
  let seq = 100;
  const currentPage = { appendChild: vi.fn<(n: unknown) => void>() };
  const loadFontAsync = vi.fn<(font: unknown) => Promise<void>>(async () => {});
  const figmaCtx = {
    mixed: Symbol('mixed'),
    currentPage,
    loadFontAsync,
    getNodeByIdAsync: async (id: string) => store.get(id) ?? null,
    createFrame: () => {
      const id = `9:${(seq += 1)}`;
      const node: Record<string, unknown> = {
        id,
        name: 'Frame',
        type: 'FRAME',
        x: 0,
        y: 0,
        resize: vi.fn<(w: number, h: number) => void>(),
        remove: vi.fn<() => void>(() => {
          store.delete(id);
        }),
      };
      store.set(id, node);
      return node;
    },
  } as unknown as typeof figma;
  return { figmaCtx, store, loadFontAsync };
};

const realWrites = (figmaCtx: typeof figma): SandboxHandlers => ({
  rename_node: createRenameNodeHandler(figmaCtx),
  set_opacity: createSetOpacityHandler(figmaCtx),
  set_fills: createSetFillsHandler(figmaCtx),
  set_strokes: createSetStrokesHandler(figmaCtx),
  set_corner_radius: createSetCornerRadiusHandler(figmaCtx),
  set_text_properties: createSetTextPropertiesHandler(figmaCtx),
  move_nodes: createMoveNodesHandler(figmaCtx),
  create_frame: createCreateFrameHandler(figmaCtx),
  create_component: createCreateComponentHandler(figmaCtx),
  delete_nodes: createDeleteNodesHandler(figmaCtx),
});

const SOLID = (r: number): unknown => ({ type: 'SOLID', color: { r, g: 0, b: 0 } });

describe('batch handler', () => {
  it('applies ops in order and returns one result per op', async () => {
    const { figmaCtx, store } = makeFigma({
      '1:1': { id: '1:1', name: 'A', opacity: 1 },
      '1:2': { id: '1:2', name: 'B', x: 10, y: 20 },
    });
    const handler = createBatchHandler(figmaCtx, realWrites(figmaCtx));

    const result = (await handler({
      ops: [
        { tool: 'rename_node', params: { nodeId: '1:1', name: 'renamed' } },
        { tool: 'set_opacity', params: { nodeId: '1:1', opacity: 0.5 } },
        { tool: 'move_nodes', params: { nodeIds: ['1:2'], dx: 5, dy: -5 } },
      ],
    })) as BatchResult;

    expect(result.ok).toBe(true);
    expect(result.results).toHaveLength(3);
    expect(store.get('1:1')).toMatchObject({ name: 'renamed', opacity: 0.5 });
    expect(store.get('1:2')).toMatchObject({ x: 15, y: 15 });
  });

  it('rejects a non-invertible op at validate time without mutating anything', async () => {
    const { figmaCtx, store } = makeFigma({ '1:1': { id: '1:1', name: 'A' } });
    const handler = createBatchHandler(figmaCtx, realWrites(figmaCtx));

    await expect(
      handler({
        ops: [
          { tool: 'rename_node', params: { nodeId: '1:1', name: 'renamed' } },
          { tool: 'delete_nodes', params: { nodeIds: ['1:1'] } },
        ],
      }),
    ).rejects.toThrow(/not batchable/);
    expect(store.get('1:1')).toMatchObject({ name: 'A' }); // untouched
  });

  it('rejects create_component with fromNodeId (no faithful inverse) at validate time', async () => {
    const { figmaCtx, store } = makeFigma({ '1:1': { id: '1:1', type: 'FRAME', name: 'A' } });
    const handler = createBatchHandler(figmaCtx, realWrites(figmaCtx));

    await expect(
      handler({
        ops: [
          { tool: 'rename_node', params: { nodeId: '1:1', name: 'renamed' } },
          { tool: 'create_component', params: { fromNodeId: '1:1' } },
        ],
      }),
    ).rejects.toThrow(/fromNodeId is not batchable/);
    expect(store.get('1:1')).toMatchObject({ name: 'A' }); // first op never applied
  });

  it('aborts in the capture phase (bad node id) before any op is applied', async () => {
    const { figmaCtx, store } = makeFigma({ '1:1': { id: '1:1', name: 'A' } });
    const handler = createBatchHandler(figmaCtx, realWrites(figmaCtx));

    await expect(
      handler({
        ops: [
          { tool: 'rename_node', params: { nodeId: '1:1', name: 'renamed' } },
          { tool: 'rename_node', params: { nodeId: 'missing', name: 'x' } },
        ],
      }),
    ).rejects.toThrow(/node missing not found/);
    expect(store.get('1:1')).toMatchObject({ name: 'A' }); // first op never applied
  });

  it('rolls back already-applied mutations when a later op fails mid-apply', async () => {
    const { figmaCtx, store } = makeFigma({
      '1:1': { id: '1:1', name: 'A', opacity: 1 },
      '1:2': { id: '1:2', name: 'B', fills: [] },
    });
    const handler = createBatchHandler(figmaCtx, realWrites(figmaCtx));

    await expect(
      handler({
        ops: [
          { tool: 'rename_node', params: { nodeId: '1:1', name: 'renamed' } },
          { tool: 'set_opacity', params: { nodeId: '1:1', opacity: 0.3 } },
          // GRADIENT is rejected by set_fills at apply time → triggers rollback of the two above.
          { tool: 'set_fills', params: { nodeId: '1:2', fills: [{ type: 'GRADIENT_LINEAR' }] } },
        ],
      }),
    ).rejects.toThrow(/op 2 \(set_fills\) failed, rolled back 2/);

    expect(store.get('1:1')).toMatchObject({ name: 'A', opacity: 1 }); // both restored
  });

  it('rolls back a create by removing the node it produced', async () => {
    const { figmaCtx, store } = makeFigma({ '1:2': { id: '1:2', fills: [] } });
    const handler = createBatchHandler(figmaCtx, realWrites(figmaCtx));

    await expect(
      handler({
        ops: [
          { tool: 'create_frame', params: { name: 'New' } },
          { tool: 'set_fills', params: { nodeId: '1:2', fills: [{ type: 'GRADIENT_LINEAR' }] } },
        ],
      }),
    ).rejects.toThrow(/rolled back 1/);

    // The frame created by op 0 was the only 9:x node; rollback removed it.
    const created = [...store.keys()].filter(k => k.startsWith('9:'));
    expect(created).toHaveLength(0);
  });

  it('restores a fill on rollback', async () => {
    const { figmaCtx, store } = makeFigma({
      '1:1': { id: '1:1', fills: [SOLID(0.2)] },
      '1:2': { id: '1:2', fills: [] },
    });
    const handler = createBatchHandler(figmaCtx, realWrites(figmaCtx));

    await expect(
      handler({
        ops: [
          { tool: 'set_fills', params: { nodeId: '1:1', fills: [SOLID(0.9)] } },
          { tool: 'set_fills', params: { nodeId: '1:2', fills: [{ type: 'GRADIENT_LINEAR' }] } },
        ],
      }),
    ).rejects.toThrow(/rolled back 1/);

    expect(store.get('1:1')!.fills).toEqual([SOLID(0.2)]); // original fill restored
  });

  it('reports undo failures instead of claiming a clean rollback', async () => {
    // op 0 creates a frame whose remove() throws → its rollback fails; op 1 throws to trigger rollback.
    const store = new Map<string, Record<string, unknown>>([['1:2', { id: '1:2', fills: [] }]]);
    const figmaCtx = {
      currentPage: { appendChild: vi.fn<(n: unknown) => void>() },
      getNodeByIdAsync: async (id: string) => store.get(id) ?? null,
      createFrame: () => {
        const node = {
          id: '9:1',
          name: 'F',
          type: 'FRAME',
          resize: vi.fn<(w: number, h: number) => void>(),
          remove: () => {
            throw new Error('cannot remove');
          },
        };
        store.set('9:1', node);
        return node;
      },
    } as unknown as typeof figma;
    const handler = createBatchHandler(figmaCtx, realWrites(figmaCtx));

    await expect(
      handler({
        ops: [
          { tool: 'create_frame', params: {} },
          { tool: 'set_fills', params: { nodeId: '1:2', fills: [{ type: 'GRADIENT_LINEAR' }] } },
        ],
      }),
    ).rejects.toThrow(/undo\(s\) FAILED.*cannot remove.*partially changed/);
  });

  it('restores per-corner radii on rollback when cornerRadius reads mixed', async () => {
    // Corners differ → the uniform cornerRadius getter is figma.mixed (a symbol the undo must
    // skip); the per-corner snapshot is what actually restores the node.
    const { figmaCtx, store } = makeFigma({
      '1:1': {
        id: '1:1',
        cornerRadius: Symbol('mixed'),
        topLeftRadius: 8,
        topRightRadius: 0,
        bottomRightRadius: 4,
        bottomLeftRadius: 0,
      },
      '1:2': { id: '1:2', fills: [] },
    });
    const handler = createBatchHandler(figmaCtx, realWrites(figmaCtx));

    await expect(
      handler({
        ops: [
          { tool: 'set_corner_radius', params: { nodeId: '1:1', radius: 12 } },
          { tool: 'set_fills', params: { nodeId: '1:2', fills: [{ type: 'GRADIENT_LINEAR' }] } },
        ],
      }),
    ).rejects.toThrow(/rolled back 1/);

    expect(store.get('1:1')).toMatchObject({
      topLeftRadius: 8,
      topRightRadius: 0,
      bottomRightRadius: 4,
      bottomLeftRadius: 0,
    });
  });

  it('restores strokeAlign / dashPattern / per-side weights on rollback', async () => {
    const { figmaCtx, store } = makeFigma({
      '1:1': {
        id: '1:1',
        strokes: [SOLID(0.2)],
        strokeWeight: Symbol('mixed'), // per-side weights differ
        strokeAlign: 'INSIDE',
        dashPattern: [4, 2],
        strokeTopWeight: 1,
        strokeRightWeight: 0,
        strokeBottomWeight: 2,
        strokeLeftWeight: 0,
      },
      '1:2': { id: '1:2', fills: [] },
    });
    const handler = createBatchHandler(figmaCtx, realWrites(figmaCtx));

    await expect(
      handler({
        ops: [
          {
            tool: 'set_strokes',
            params: {
              nodeId: '1:1',
              strokes: [SOLID(0.9)],
              strokeWeight: 3,
              strokeAlign: 'CENTER',
              dashPattern: [],
            },
          },
          { tool: 'set_fills', params: { nodeId: '1:2', fills: [{ type: 'GRADIENT_LINEAR' }] } },
        ],
      }),
    ).rejects.toThrow(/rolled back 1/);

    expect(store.get('1:1')).toMatchObject({
      strokes: [SOLID(0.2)],
      strokeAlign: 'INSIDE',
      dashPattern: [4, 2],
      strokeTopWeight: 1,
      strokeRightWeight: 0,
      strokeBottomWeight: 2,
      strokeLeftWeight: 0,
    });
  });

  it('restores typography on set_text_properties rollback, reloading fonts first', async () => {
    const { figmaCtx, store, loadFontAsync } = makeFigma({
      '1:1': {
        id: '1:1',
        type: 'TEXT',
        characters: 'Hi',
        fontName: { family: 'Inter', style: 'Regular' },
        fontSize: 12,
        lineHeight: { unit: 'AUTO' },
        letterSpacing: { value: 0, unit: 'PIXELS' },
        textCase: 'ORIGINAL',
        textDecoration: 'NONE',
        paragraphSpacing: 0,
        paragraphIndent: 0,
        textAutoResize: 'WIDTH_AND_HEIGHT',
        textTruncation: 'DISABLED',
        maxLines: null,
      },
      '1:2': { id: '1:2', fills: [] },
    });
    const handler = createBatchHandler(figmaCtx, realWrites(figmaCtx));

    await expect(
      handler({
        ops: [
          {
            tool: 'set_text_properties',
            params: {
              nodeId: '1:1',
              fontName: { family: 'Arial', style: 'Bold' },
              fontSize: 24,
              textCase: 'UPPER',
              paragraphSpacing: 8,
              textAutoResize: 'HEIGHT',
            },
          },
          { tool: 'set_fills', params: { nodeId: '1:2', fills: [{ type: 'GRADIENT_LINEAR' }] } },
        ],
      }),
    ).rejects.toThrow(/rolled back 1/);

    expect(store.get('1:1')).toMatchObject({
      fontName: { family: 'Inter', style: 'Regular' },
      fontSize: 12,
      textCase: 'ORIGINAL',
      paragraphSpacing: 0,
      textAutoResize: 'WIDTH_AND_HEIGHT',
    });
    // The undo reloads the captured (pre-op) font before restoring — it's the final font load.
    expect(loadFontAsync.mock.calls.at(-1)).toEqual([{ family: 'Inter', style: 'Regular' }]);
  });

  it('replays as a unit under idempotency: same requestId applies its ops once', async () => {
    const { figmaCtx, store } = makeFigma({ '1:2': { id: '1:2', x: 0, y: 0 } });
    const batch = idempotent(
      createIdempotencyCache(),
      createBatchHandler(figmaCtx, realWrites(figmaCtx)),
    );
    const call = {
      requestId: 'r1',
      ops: [{ tool: 'move_nodes', params: { nodeIds: ['1:2'], dx: 10, dy: 0 } }],
    };

    const first = (await batch(call)) as BatchResult;
    const replay = (await batch(call)) as BatchResult;

    expect(replay).toEqual(first); // cached result returned, not re-run
    expect(store.get('1:2')).toMatchObject({ x: 10, y: 0 }); // moved once, not twice
  });

  it('validates the ops envelope', async () => {
    const { figmaCtx } = makeFigma({});
    const handler = createBatchHandler(figmaCtx, realWrites(figmaCtx));
    await expect(handler({})).rejects.toThrow(/ops must be an array/);
    await expect(handler({ ops: [] })).rejects.toThrow(/must not be empty/);
    await expect(handler({ ops: [{ params: {} }] })).rejects.toThrow(/tool must be a string/);
  });
});

// ── Motion (beta) batch inverses ─────────────────────────────────────────────

const makeMotionFigma = (editorType = 'figma') => {
  const store = new Map<string, Record<string, unknown>>();

  const addMotionNode = (
    id: string,
    init: { tracks?: Record<string, unknown>; timelines?: { id: string; duration: number }[] } = {},
  ) => {
    const applied: { id: string; styleId: string }[] = [];
    const tracks: Record<string, unknown> = { ...init.tracks };
    const timelines = init.timelines ?? [];
    let seq = 0;
    const node = {
      id,
      get animationStyles() {
        return applied.slice();
      },
      get manualKeyframeTracks() {
        return tracks;
      },
      get timelines() {
        return timelines;
      },
      applyAnimationStyle: vi.fn<(styleId: string) => string>((styleId: string) => {
        const appliedId = `${id}:as:${(seq += 1)}`;
        applied.push({ id: appliedId, styleId });
        return appliedId;
      }),
      removeAnimationStyle: vi.fn<(appliedId: string) => void>((appliedId: string) => {
        const i = applied.findIndex(a => a.id === appliedId);
        if (i >= 0) applied.splice(i, 1);
      }),
      applyManualKeyframeTrack: vi.fn<
        (field: { type: string; name?: string }, track: unknown) => void
      >((field: { type: string; name?: string }, track: unknown) => {
        if (field.type === 'PROPERTY' && field.name !== undefined) tracks[field.name] = track;
      }),
      removeManualKeyframeTrack: vi.fn<(field: { type: string; name?: string }) => void>(
        (field: { type: string; name?: string }) => {
          if (field.type === 'PROPERTY' && field.name !== undefined) delete tracks[field.name];
        },
      ),
      setTimelineDuration: vi.fn<(tid: string, d: number) => void>((tid: string, d: number) => {
        const t = timelines.find(x => x.id === tid);
        if (t !== undefined) t.duration = d;
      }),
    };
    store.set(id, node as unknown as Record<string, unknown>);
    return node;
  };

  const figmaCtx = {
    editorType,
    getNodeByIdAsync: async (id: string) => store.get(id) ?? null,
  } as unknown as typeof figma;

  return { figmaCtx, store, addMotionNode };
};

const motionWrites = (figmaCtx: typeof figma): SandboxHandlers => ({
  apply_animation_style: createApplyAnimationStyleHandler(figmaCtx),
  apply_manual_keyframe_track: createApplyManualKeyframeTrackHandler(figmaCtx),
  set_timeline_duration: createSetTimelineDurationHandler(figmaCtx),
  set_fills: createSetFillsHandler(figmaCtx),
});

/** A trailing op that always fails at apply time, forcing rollback of the preceding Motion op. */
const FAILING_FILL = {
  tool: 'set_fills',
  params: { nodeId: 'F', fills: [{ type: 'GRADIENT_LINEAR' }] },
};

describe('batch Motion inverses', () => {
  it('rolls back apply_animation_style by removing the applied style instance', async () => {
    const { figmaCtx, store, addMotionNode } = makeMotionFigma();
    const a = addMotionNode('1:1');
    store.set('F', { id: 'F', fills: [] });
    const handler = createBatchHandler(figmaCtx, motionWrites(figmaCtx));

    await expect(
      handler({
        ops: [
          { tool: 'apply_animation_style', params: { nodeId: '1:1', styleId: 's1' } },
          FAILING_FILL,
        ],
      }),
    ).rejects.toThrow(/rolled back 1/);

    expect(a.removeAnimationStyle).toHaveBeenCalledWith('1:1:as:1');
    expect(a.animationStyles).toHaveLength(0);
  });

  it('restores a prior PROPERTY keyframe track on rollback', async () => {
    const OLD = {
      baseValue: { type: 'FLOAT', value: 0 },
      keyframes: [{ timelinePosition: 0, value: { type: 'FLOAT', value: 0 } }],
    };
    const { figmaCtx, store, addMotionNode } = makeMotionFigma();
    const a = addMotionNode('1:1', { tracks: { TRANSLATION_X: OLD } });
    store.set('F', { id: 'F', fills: [] });
    const handler = createBatchHandler(figmaCtx, motionWrites(figmaCtx));

    await expect(
      handler({
        ops: [
          {
            tool: 'apply_manual_keyframe_track',
            params: {
              nodeId: '1:1',
              field: { type: 'PROPERTY', name: 'TRANSLATION_X' },
              track: {
                keyframes: [{ timelinePosition: 0.3, value: { type: 'FLOAT', value: 120 } }],
              },
            },
          },
          FAILING_FILL,
        ],
      }),
    ).rejects.toThrow(/rolled back 1/);

    expect(a.manualKeyframeTracks.TRANSLATION_X).toEqual(OLD); // deep-equal, from the cloned snapshot
  });

  it('removes a PROPERTY keyframe track on rollback when there was none before', async () => {
    const { figmaCtx, store, addMotionNode } = makeMotionFigma();
    const a = addMotionNode('1:1');
    store.set('F', { id: 'F', fills: [] });
    const handler = createBatchHandler(figmaCtx, motionWrites(figmaCtx));

    await expect(
      handler({
        ops: [
          {
            tool: 'apply_manual_keyframe_track',
            params: {
              nodeId: '1:1',
              field: { type: 'PROPERTY', name: 'OPACITY' },
              track: { keyframes: [{ timelinePosition: 0, value: { type: 'FLOAT', value: 1 } }] },
            },
          },
          FAILING_FILL,
        ],
      }),
    ).rejects.toThrow(/rolled back 1/);

    expect(a.removeManualKeyframeTrack).toHaveBeenCalledWith({ type: 'PROPERTY', name: 'OPACITY' });
    expect(a.manualKeyframeTracks.OPACITY).toBeUndefined();
  });

  it('rejects an indexed (effects) keyframe track as not batchable, before any op runs', async () => {
    const { figmaCtx, addMotionNode } = makeMotionFigma();
    addMotionNode('1:1');
    const handler = createBatchHandler(figmaCtx, motionWrites(figmaCtx));

    await expect(
      handler({
        ops: [
          {
            tool: 'apply_manual_keyframe_track',
            params: {
              nodeId: '1:1',
              field: { type: 'INDEXED_ITEM', collection: 'effects', index: 0, field: 'RADIUS' },
              track: { keyframes: [{ timelinePosition: 0, value: { type: 'FLOAT', value: 1 } }] },
            },
          },
        ],
      }),
    ).rejects.toThrow(/only PROPERTY fields are batchable/);
  });

  it('restores a timeline duration on rollback', async () => {
    const { figmaCtx, store, addMotionNode } = makeMotionFigma();
    const a = addMotionNode('1:1', { timelines: [{ id: 't1', duration: 1 }] });
    store.set('F', { id: 'F', fills: [] });
    const handler = createBatchHandler(figmaCtx, motionWrites(figmaCtx));

    await expect(
      handler({
        ops: [
          {
            tool: 'set_timeline_duration',
            params: { nodeId: '1:1', timelineId: 't1', duration: 5 },
          },
          FAILING_FILL,
        ],
      }),
    ).rejects.toThrow(/rolled back 1/);

    expect(a.timelines[0]!.duration).toBe(1);
  });

  it('rejects Motion ops outside the Figma Design editor at capture time', async () => {
    const { figmaCtx, addMotionNode } = makeMotionFigma('figjam');
    addMotionNode('1:1');
    const handler = createBatchHandler(figmaCtx, motionWrites(figmaCtx));

    await expect(
      handler({
        ops: [{ tool: 'apply_animation_style', params: { nodeId: '1:1', styleId: 's1' } }],
      }),
    ).rejects.toThrow(/Figma Design editor/);
  });
});
