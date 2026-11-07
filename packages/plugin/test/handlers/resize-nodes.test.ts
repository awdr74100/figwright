import type { ResizeNodesResult } from '@figwright/shared';
import { describe, expect, it, vi } from 'vitest';

import { createResizeNodesHandler } from '../../src/handlers/resize-nodes.js';

const fakeFigma = (lookup: Record<string, unknown>): typeof figma =>
  ({ getNodeByIdAsync: async (id: string) => lookup[id] ?? null }) as unknown as typeof figma;

interface FakeNode {
  id: string;
  name: string;
  type: string;
  parent: FakeNode | null;
  width: number;
  height: number;
  minWidth?: number | null;
  maxWidth?: number | null;
  resize: ReturnType<typeof vi.fn<(w: number, h: number) => void>>;
}

/**
 * A node whose `resize` behaves the way Figma was measured to: `applies` decides what size the node
 * ends at, so a layer Figma ignores and one a bound clamps are both expressible.
 */
const node = (
  id: string,
  init: Partial<Omit<FakeNode, 'resize'>> & {
    applies?: (w: number, h: number, self: FakeNode) => [number, number] | null;
  } = {},
): FakeNode => {
  const { applies = (w, h) => [w, h], ...rest } = init;
  const self: FakeNode = {
    id,
    name: id,
    type: 'FRAME',
    parent: null,
    width: 100,
    height: 20,
    ...rest,
    resize: vi.fn<(w: number, h: number) => void>((w, h) => {
      const next = applies(w, h, self);
      if (next !== null) [self.width, self.height] = next;
    }),
  };
  return self;
};

// Figma ignores resize() on a layer inside an instance, without throwing.
const ignored = () => null;

const instance = node('5:1', { type: 'INSTANCE', name: 'ProgressBar' });

describe('resize_nodes handler', () => {
  it('reports nodes that reached the size, and skips non-resizable and missing ones', async () => {
    const a = node('1:1');
    const noResize = { id: '1:2', type: 'GROUP', parent: null };
    const handler = createResizeNodesHandler(fakeFigma({ '1:1': a, '1:2': noResize }));
    const result = (await handler({
      nodeIds: ['1:1', '1:2', '9:9'],
      width: 200,
      height: 80,
    })) as ResizeNodesResult;

    expect(a.resize).toHaveBeenCalledWith(200, 80);
    expect(result).toEqual({ ok: true, affected: ['1:1'] });
  });

  it('refuses a layer inside an instance that Figma left untouched, naming the way out', async () => {
    const layer = node('I5:1;2:2', { parent: instance, width: 238, height: 8, applies: ignored });
    const handler = createResizeNodesHandler(fakeFigma({ 'I5:1;2:2': layer }));

    const call = handler({ nodeIds: ['I5:1;2:2'], width: 150, height: 8 });
    await expect(call).rejects.toThrow(/nothing was resized/);
    await expect(handler({ nodeIds: ['I5:1;2:2'], width: 150, height: 8 })).rejects.toThrow(
      /I5:1;2:2 stayed 238 × 8: it sits inside instance 5:1 \("ProgressBar"\).*detach_instance/,
    );
  });

  it('treats a nested instance like any other layer inside an instance', async () => {
    const nested = node('I5:1;3:3', { type: 'INSTANCE', parent: instance, applies: ignored });
    const handler = createResizeNodesHandler(fakeFigma({ 'I5:1;3:3': nested }));

    await expect(handler({ nodeIds: ['I5:1;3:3'], width: 160, height: 12 })).rejects.toThrow(
      /inside instance 5:1/,
    );
  });

  it('resizes content inside an instance when Figma does apply it — no rule refuses it up front', async () => {
    const slotContent = node('I5:1;4:4', {
      parent: node('I5:1;4:0', { type: 'SLOT', parent: instance }),
    });
    const handler = createResizeNodesHandler(fakeFigma({ 'I5:1;4:4': slotContent }));

    const result = (await handler({
      nodeIds: ['I5:1;4:4'],
      width: 150,
      height: 30,
    })) as ResizeNodesResult;
    expect(result).toEqual({ ok: true, affected: ['I5:1;4:4'] });
  });

  it('keeps a mixed call: resizes what it can and accounts for the instance layer it could not', async () => {
    const plain = node('1:1');
    const layer = node('I5:1;2:2', { parent: instance, width: 238, height: 8, applies: ignored });
    const handler = createResizeNodesHandler(fakeFigma({ '1:1': plain, 'I5:1;2:2': layer }));

    const result = (await handler({
      nodeIds: ['1:1', 'I5:1;2:2'],
      width: 150,
      height: 8,
    })) as ResizeNodesResult;
    expect(result.affected).toEqual(['1:1']);
    expect(result.adjusted).toEqual([
      expect.objectContaining({ nodeId: 'I5:1;2:2', width: 238, height: 8 }),
    ]);
    expect(result.adjusted?.[0]?.reason).toMatch(/inside instance 5:1/);
  });

  it('reads every size after all writes, so a later write that carries an earlier node along is seen', async () => {
    // The instance's copy is listed first; resizing the main component's layer afterwards carries
    // the copy to the requested size. Read straight after its own (ignored) write, it looked unmoved.
    const copy = node('I5:1;2:2', { parent: instance, applies: ignored });
    const main = node('2:2', {
      applies: (w, h) => {
        [copy.width, copy.height] = [w, h];
        return [w, h];
      },
    });
    const handler = createResizeNodesHandler(fakeFigma({ 'I5:1;2:2': copy, '2:2': main }));

    const result = (await handler({
      nodeIds: ['I5:1;2:2', '2:2'],
      width: 130,
      height: 26,
    })) as ResizeNodesResult;
    expect(result).toEqual({ ok: true, affected: ['I5:1;2:2', '2:2'] });
  });

  it('reports the bound that clamped an axis, with the size the node really has', async () => {
    const capped = node('1:1', {
      maxWidth: 100,
      applies: (w, h, self) => [Math.min(w, self.maxWidth ?? w), h],
    });
    const handler = createResizeNodesHandler(fakeFigma({ '1:1': capped }));

    const result = (await handler({
      nodeIds: ['1:1'],
      width: 160,
      height: 12,
    })) as ResizeNodesResult;
    expect(result).toEqual({
      ok: true,
      affected: [],
      adjusted: [
        {
          nodeId: '1:1',
          width: 100,
          height: 12,
          reason: expect.stringMatching(/^held by maxWidth 100 — .*set_layout_props/),
        },
      ],
    });
  });

  it('says what size Figma chose when no bound or instance explains it', async () => {
    const odd = node('1:1', { applies: (_w, h) => [90, h] });
    const handler = createResizeNodesHandler(fakeFigma({ '1:1': odd }));

    const result = (await handler({
      nodeIds: ['1:1'],
      width: 150,
      height: 30,
    })) as ResizeNodesResult;
    expect(result.adjusted).toEqual([
      { nodeId: '1:1', width: 90, height: 30, reason: 'Figma sized it to 90 × 30 instead' },
    ]);
  });

  it('counts a layer already at the requested size as reached, even inside an instance', async () => {
    const layer = node('I5:1;2:2', { parent: instance, width: 150, height: 8, applies: ignored });
    const handler = createResizeNodesHandler(fakeFigma({ 'I5:1;2:2': layer }));

    const result = (await handler({
      nodeIds: ['I5:1;2:2'],
      width: 150,
      height: 8,
    })) as ResizeNodesResult;
    expect(result).toEqual({ ok: true, affected: ['I5:1;2:2'] });
  });

  it('tolerates the float noise Figma stores sizes with', async () => {
    const a = node('1:1', { applies: (w, h) => [w + 0.000_01, h] });
    const handler = createResizeNodesHandler(fakeFigma({ '1:1': a }));

    const result = (await handler({
      nodeIds: ['1:1'],
      width: 33.333,
      height: 8,
    })) as ResizeNodesResult;
    expect(result).toEqual({ ok: true, affected: ['1:1'] });
  });

  it('throws on non-positive dimensions and bad input', async () => {
    const handler = createResizeNodesHandler(fakeFigma({}));
    await expect(handler({ nodeIds: ['1:1'], width: 0, height: 10 })).rejects.toThrow(
      /width and height/,
    );
    await expect(handler({ nodeIds: 'x', width: 1, height: 1 })).rejects.toThrow(/nodeIds/);
  });

  // Measured: resizing an auto-height text to a new height makes it a fixed box, which shows no line
  // count, so a maxLines clamp is cleared. The text still reaches its size; the clamp it lost is named.
  describe('a text clamped to a line count', () => {
    const clamped = (id: string) => {
      const text = {
        id,
        name: id,
        type: 'TEXT',
        parent: null,
        width: 240,
        height: 30,
        maxLines: 2 as number | null,
        maxHeight: null,
        textAutoResize: 'HEIGHT',
        resize: vi.fn<(w: number, h: number) => void>((w, h) => {
          if (h !== text.height) {
            text.textAutoResize = 'TRUNCATE';
            text.maxLines = null;
          }
          [text.width, text.height] = [w, h];
        }),
      };
      return text;
    };

    it('lists the text in cleared when a new height drops its clamp', async () => {
      const text = clamped('1:7');
      const result = (await createResizeNodesHandler(fakeFigma({ '1:7': text }))({
        nodeIds: ['1:7'],
        width: 240,
        height: 60,
      })) as ResizeNodesResult;
      expect(result).toEqual({
        ok: true,
        affected: ['1:7'],
        cleared: [
          {
            nodeId: '1:7',
            reason:
              'maxLines 2 was cleared — the box is now a fixed height, which truncates at its own ' +
              'edge and shows no line count',
          },
        ],
      });
    });

    it('lists nothing when the height stays and the clamp with it', async () => {
      const text = clamped('1:7');
      const result = (await createResizeNodesHandler(fakeFigma({ '1:7': text }))({
        nodeIds: ['1:7'],
        width: 200,
        height: 30,
      })) as ResizeNodesResult;
      expect(text.maxLines).toBe(2);
      expect(result).toEqual({ ok: true, affected: ['1:7'] });
    });
  });

  // Measured: a resize a bound holds at its size still turns a HUG / FILL axis FIXED and an auto-sized
  // text a fixed box. A node whose size did not move is put back, so an error means nothing changed.
  describe('a node held at its size', () => {
    const IDENTITY = [
      [1, 0, 0],
      [0, 1, 0],
    ];
    /** A HUG frame a bound holds: resize() flips its sizing to FIXED and keeps its size. */
    const heldFrame = (id: string) => {
      const frame = {
        id,
        name: id,
        type: 'FRAME',
        parent: null,
        width: 40,
        height: 20,
        x: 0,
        y: 0,
        relativeTransform: IDENTITY,
        layoutGrow: 0,
        layoutAlign: 'INHERIT',
        primaryAxisSizingMode: 'AUTO',
        counterAxisSizingMode: 'AUTO',
        maxWidth: 40,
        maxHeight: 20,
        resize: vi.fn<(w: number, h: number) => void>(() => {
          frame.primaryAxisSizingMode = 'FIXED';
          frame.counterAxisSizingMode = 'FIXED';
        }),
        resizeWithoutConstraints: vi.fn<(w: number, h: number) => void>(),
      };
      return frame;
    };
    /** An auto-height text a maxHeight holds: resize() fixes the box and keeps the size. */
    const heldText = (id: string) => {
      const text = {
        id,
        name: id,
        type: 'TEXT',
        parent: null,
        width: 240,
        height: 40,
        x: 0,
        y: 0,
        relativeTransform: IDENTITY,
        characters: 'abc',
        fontName: { family: 'Inter', style: 'Regular' },
        textAutoResize: 'HEIGHT',
        textTruncation: 'ENDING',
        maxLines: null as number | null,
        maxHeight: 40,
        layoutGrow: 0,
        layoutAlign: 'INHERIT',
        resize: vi.fn<(w: number, h: number) => void>(() => {
          text.textAutoResize = 'TRUNCATE';
        }),
        resizeWithoutConstraints: vi.fn<(w: number, h: number) => void>(),
      };
      return text;
    };
    const withFonts = (lookup: Record<string, unknown>) => {
      const loadFontAsync = vi.fn<() => Promise<void>>(async () => {});
      const ctx = {
        getNodeByIdAsync: async (id: string) => lookup[id] ?? null,
        loadFontAsync,
        mixed: Symbol('mixed'),
      } as unknown as typeof figma;
      return { ctx, loadFontAsync };
    };

    it('puts a held frame back as HUG before refusing the call', async () => {
      const frame = heldFrame('1:8');
      await expect(
        createResizeNodesHandler(withFonts({ '1:8': frame }).ctx)({
          nodeIds: ['1:8'],
          width: 90,
          height: 60,
        }),
      ).rejects.toThrow(/nothing was resized/);
      expect(frame).toMatchObject({ primaryAxisSizingMode: 'AUTO', counterAxisSizingMode: 'AUTO' });
    });

    it("loads a held text's fonts and puts its auto height back", async () => {
      const text = heldText('1:9');
      const { ctx, loadFontAsync } = withFonts({ '1:9': text });
      await expect(
        createResizeNodesHandler(ctx)({ nodeIds: ['1:9'], width: 240, height: 60 }),
      ).rejects.toThrow(/nothing was resized/);
      expect(loadFontAsync).toHaveBeenCalledWith({ family: 'Inter', style: 'Regular' });
      expect(text.textAutoResize).toBe('HEIGHT');
    });

    it('puts back only the nodes that did not move, in a call that resized others', async () => {
      const frame = heldFrame('1:8');
      const free = node('1:1');
      const result = (await createResizeNodesHandler(withFonts({ '1:8': frame, '1:1': free }).ctx)({
        nodeIds: ['1:8', '1:1'],
        width: 90,
        height: 60,
      })) as ResizeNodesResult;
      expect(result.affected).toEqual(['1:1']);
      expect(result.adjusted?.[0]).toMatchObject({ nodeId: '1:8', width: 40, height: 20 });
      expect(result.adjusted?.[0]?.reason).not.toMatch(/put back|left with/);
      expect(frame.primaryAxisSizingMode).toBe('AUTO');
    });

    // A node that moved on one side and was held on the other did resize: its FIXED sizing is the
    // resize's own, and putting it back would undo the side that landed.
    it('leaves a partly resized node as the resize left it', async () => {
      const frame = {
        ...heldFrame('1:8'),
        resizeWithoutConstraints: vi.fn<(w: number, h: number) => void>((w, h) => {
          [frame.width, frame.height] = [w, h];
        }),
      };
      frame.resize = vi.fn<(w: number, h: number) => void>(w => {
        frame.width = w;
        frame.primaryAxisSizingMode = 'FIXED';
        frame.counterAxisSizingMode = 'FIXED';
      });
      const result = (await createResizeNodesHandler(withFonts({ '1:8': frame }).ctx)({
        nodeIds: ['1:8'],
        width: 90,
        height: 60,
      })) as ResizeNodesResult;
      expect(result.adjusted?.[0]).toMatchObject({ nodeId: '1:8', width: 90, height: 20 });
      expect(frame).toMatchObject({ width: 90, primaryAxisSizingMode: 'FIXED' });
      expect(frame.resizeWithoutConstraints).not.toHaveBeenCalled();
    });

    it('writes nothing to a held node that kept its sizing, not even a font load', async () => {
      const text = { ...heldText('1:9'), resize: vi.fn<(w: number, h: number) => void>() };
      const { ctx, loadFontAsync } = withFonts({ '1:9': text });
      await expect(
        createResizeNodesHandler(ctx)({ nodeIds: ['1:9'], width: 240, height: 60 }),
      ).rejects.toThrow(/nothing was resized/);
      expect(loadFontAsync).not.toHaveBeenCalled();
    });
  });
});
