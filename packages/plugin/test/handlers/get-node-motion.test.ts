import type { GetNodeMotionResult } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import { createGetNodeMotionHandler } from '../../src/handlers/get-node-motion.js';

/** A node carrying the Motion mixin — `isMotionNode` keys off `applyAnimationStyle`. */
const motionNode = (id: string): BaseNode =>
  ({
    id,
    applyAnimationStyle: () => {},
    animationStyles: [{ styleId: 'S:1', name: 'Fade in' }],
    animations: { OPACITY: { keyframes: [] } },
    manualKeyframeTracks: { TRANSLATION_X: { keyframes: [] } },
    timelines: [{ id: 'T:1', duration: 2, extra: 'ignored' }],
  }) as unknown as BaseNode;

/** A node with no Motion mixin at all (PAGE / DOCUMENT). */
const plainNode = (id: string): BaseNode => ({ id }) as unknown as BaseNode;

const fakeFigma = (opts: {
  editorType: string;
  playheadPosition?: number;
  node?: BaseNode | null;
}): typeof figma =>
  ({
    editorType: opts.editorType,
    motion: { playheadPosition: opts.playheadPosition },
    getNodeByIdAsync: async () => opts.node ?? null,
  }) as unknown as typeof figma;

describe('get_node_motion handler', () => {
  it("returns the node's Motion state alongside the editor playhead", async () => {
    const handler = createGetNodeMotionHandler(
      fakeFigma({ editorType: 'figma', playheadPosition: 1.25, node: motionNode('1:2') }),
    );
    const result = (await handler({ nodeId: '1:2' })) as GetNodeMotionResult;
    expect(result.nodeId).toBe('1:2');
    expect(result.playheadPosition).toBe(1.25);
    expect(result.motion?.timelines).toEqual([{ id: 'T:1', duration: 2 }]);
    expect(result.motion?.animationStyles).toEqual([{ styleId: 'S:1', name: 'Fade in' }]);
  });

  it('still reports the playhead when the node itself supports no Motion', async () => {
    const handler = createGetNodeMotionHandler(
      fakeFigma({ editorType: 'figma', playheadPosition: 0, node: plainNode('1:3') }),
    );
    const result = (await handler({ nodeId: '1:3' })) as GetNodeMotionResult;
    expect(result.motion).toBeNull();
    // 0 is a real playhead position — it must survive, not be dropped as falsy.
    expect(result.playheadPosition).toBe(0);
  });

  it('omits playheadPosition entirely when no timeline is active', async () => {
    const handler = createGetNodeMotionHandler(
      fakeFigma({ editorType: 'figma', node: motionNode('1:4') }),
    );
    const result = (await handler({ nodeId: '1:4' })) as GetNodeMotionResult;
    expect('playheadPosition' in result).toBe(false);
  });

  it('never touches figma.motion outside the Figma Design editor', async () => {
    const figmaCtx = {
      editorType: 'figjam',
      get motion(): never {
        throw new Error('figma.motion must not be read in FigJam');
      },
      getNodeByIdAsync: async () => motionNode('1:5'),
    } as unknown as typeof figma;
    const result = (await createGetNodeMotionHandler(figmaCtx)({
      nodeId: '1:5',
    })) as GetNodeMotionResult;
    expect('playheadPosition' in result).toBe(false);
    expect(result.motion).not.toBeNull();
  });

  it('returns motion: null for an unknown node id', async () => {
    const handler = createGetNodeMotionHandler({
      editorType: 'figma',
      motion: { playheadPosition: 3 },
      getNodeByIdAsync: async () => null,
    } as unknown as typeof figma);
    const result = (await handler({ nodeId: 'nope' })) as GetNodeMotionResult;
    expect(result).toEqual({ nodeId: 'nope', motion: null, playheadPosition: 3 });
  });

  it('throws when nodeId is the wrong type', async () => {
    const handler = createGetNodeMotionHandler(fakeFigma({ editorType: 'figma' }));
    await expect(handler({ nodeId: 5 })).rejects.toThrow(/nodeId/);
  });
});
