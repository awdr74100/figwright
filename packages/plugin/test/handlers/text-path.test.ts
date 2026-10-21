import type { CreateResult } from '@figwright/shared';
import { describe, expect, it, vi } from 'vitest';

import {
  createCreateTextPathHandler,
  createSetTextPathHandler,
} from '../../src/handlers/text-path.js';

const segments = (n: number) => ({ segments: Array.from({ length: n }, () => ({})) });

const setup = (sourceType = 'ELLIPSE') => {
  const log: string[] = [];
  const parent = {
    id: '0:1',
    type: 'FRAME',
    children: [] as unknown[],
    insertChild: vi.fn<(index: number, child: unknown) => void>((index, child) => {
      log.push(`insert@${index}`);
      parent.children.splice(index, 0, child);
    }),
  };
  const below = { id: '1:1', type: 'RECTANGLE', parent };
  const source = {
    id: '1:2',
    type: sourceType,
    parent,
    vectorNetwork: segments(3),
    clone: vi.fn<() => unknown>(() => ({ id: 'copy', type: sourceType })),
  };
  const above = { id: '1:3', type: 'RECTANGLE', parent };
  parent.children.push(below, source, above);
  const made: Record<string, unknown>[] = [];
  const createTextPath = vi.fn<
    (node: { id: string }, segment: number, position: number) => Record<string, unknown>
  >((node, segment, position) => {
    log.push(`create:${node.id}`);
    const tp: Record<string, unknown> = {
      id: node.id === 'copy' ? 'probe' : '9:9',
      name: 'Text on path',
      type: 'TEXT_PATH',
      vectorNetwork: segments(4),
      textPathStartData: { segment, position },
      remove: vi.fn<() => void>(),
      setFillsAsync: vi.fn<(paints: unknown) => Promise<void>>(),
    };
    // Figma hands the result to the page; the source leaves its parent.
    if (node === source) parent.children.splice(parent.children.indexOf(source), 1);
    made.push(tp);
    return tp;
  });
  const loadFontAsync = vi.fn<(font: FontName) => Promise<void>>(async font => {
    log.push(`font:${font.family} ${font.style}`);
  });
  const nodes: Record<string, unknown> = { '1:1': below, '1:2': source, '1:3': above };
  const ctx = {
    getNodeByIdAsync: async (id: string) => nodes[id] ?? made.find(m => m.id === id) ?? null,
    createTextPath,
    loadFontAsync,
    variables: {},
  } as unknown as typeof figma;
  return { ctx, parent, source, made, log, createTextPath, loadFontAsync };
};

describe('create_text_path handler', () => {
  it('converts the shape in place: same parent and index, fonts loaded first, then styled', async () => {
    const t = setup();
    const result = (await createCreateTextPathHandler(t.ctx)({
      nodeId: '1:2',
      characters: 'Round and round',
      fontName: { family: 'Inter', style: 'Bold' },
      fontSize: 16,
      textAlignHorizontal: 'CENTER',
      textAlignVertical: 'BOTTOM',
      name: 'Badge',
    })) as CreateResult;
    expect(t.log).toEqual(['font:Inter Regular', 'font:Inter Bold', 'create:1:2', 'insert@1']);
    expect(t.parent.children[1]).toBe(t.made[0]);
    expect(t.made[0]).toMatchObject({
      characters: 'Round and round',
      fontName: { family: 'Inter', style: 'Bold' },
      fontSize: 16,
      textAlignHorizontal: 'CENTER',
      textAlignVertical: 'BOTTOM',
      name: 'Badge',
    });
    expect(result).toEqual({ ok: true, nodeId: '9:9', name: 'Badge', type: 'TEXT_PATH' });
  });

  it('checks a shape’s start segment on a throwaway copy, before the shape is consumed', async () => {
    const t = setup();
    await expect(
      createCreateTextPathHandler(t.ctx)({ nodeId: '1:2', characters: 'x', startSegment: 4 }),
    ).rejects.toThrow("1:2's path has 4 segments (0–3), so startSegment 4 does not exist");
    expect(t.log).not.toContain('create:1:2');
    // The copy was converted to count its segments, then removed.
    expect(t.made[0]?.remove).toHaveBeenCalled();
    await createCreateTextPathHandler(t.ctx)({ nodeId: '1:2', characters: 'x', startSegment: 3 });
    expect(t.createTextPath).toHaveBeenLastCalledWith(t.source, 3, 0);
  });

  it('reads a vector’s segments directly, without a copy', async () => {
    const t = setup('VECTOR');
    await expect(
      createCreateTextPathHandler(t.ctx)({ nodeId: '1:2', characters: 'x', startSegment: 3 }),
    ).rejects.toThrow('has 3 segments');
    expect(t.source.clone).not.toHaveBeenCalled();
  });

  it.each([
    [{ nodeId: '1:2', characters: '' }, 'non-empty'],
    [{ nodeId: '1:2', characters: 'x', startPosition: 1.5 }, 'between 0 and 1'],
    [{ nodeId: '1:2', characters: 'x', startSegment: -1 }, 'whole number'],
    [{ nodeId: '1:2', characters: 'x', textAlignVertical: 'MIDDLE' }, 'TOP, CENTER or BOTTOM'],
  ])('refuses %j before anything is converted', async (params, message) => {
    const t = setup();
    await expect(createCreateTextPathHandler(t.ctx)(params)).rejects.toThrow(message);
    expect(t.createTextPath).not.toHaveBeenCalled();
  });

  it('names what text can follow when given something else', async () => {
    const t = setup('FRAME');
    await expect(
      createCreateTextPathHandler(t.ctx)({ nodeId: '1:2', characters: 'x' }),
    ).rejects.toThrow('is a FRAME — text can follow a vector, a line or a shape');
  });
});

describe('set_text_path handler', () => {
  const textPath = () => {
    const node = {
      id: '2:1',
      type: 'TEXT_PATH',
      vectorNetwork: segments(4),
      textPathStartData: { segment: 1, position: 0.25 },
    };
    const ctx = { getNodeByIdAsync: async () => node } as unknown as typeof figma;
    return { node, ctx };
  };

  it('moves the start, keeping whichever half is not given', async () => {
    const t = textPath();
    await createSetTextPathHandler(t.ctx)({ nodeId: '2:1', startPosition: 0.5 });
    expect(t.node.textPathStartData).toEqual({ segment: 1, position: 0.5 });
    await createSetTextPathHandler(t.ctx)({ nodeId: '2:1', startSegment: 3 });
    expect(t.node.textPathStartData).toEqual({ segment: 3, position: 0.5 });
  });

  it('refuses a segment past the last, which Figma would silently drop', async () => {
    const t = textPath();
    await expect(
      createSetTextPathHandler(t.ctx)({ nodeId: '2:1', startSegment: 4 }),
    ).rejects.toThrow('keep the start where it is');
    expect(t.node.textPathStartData).toEqual({ segment: 1, position: 0.25 });
  });

  it('needs something to move, and a text path to move it on', async () => {
    const t = textPath();
    await expect(createSetTextPathHandler(t.ctx)({ nodeId: '2:1' })).rejects.toThrow(
      'give startSegment, startPosition or both',
    );
    const ctx = {
      getNodeByIdAsync: async () => ({ id: '3:1', type: 'TEXT' }),
    } as unknown as typeof figma;
    await expect(createSetTextPathHandler(ctx)({ nodeId: '3:1', startSegment: 0 })).rejects.toThrow(
      'not text on a path',
    );
  });
});

describe('create_text_path in a group of one', () => {
  it('keeps the group alive with a stand-in until the text takes the shape’s place', async () => {
    const log: string[] = [];
    const group: Record<string, unknown> & { children: unknown[] } = {
      id: 'G',
      type: 'GROUP',
      children: [],
      appendChild: (child: { id: string }) => {
        log.push(`append:${child.id}`);
        group.children.push(child);
      },
      insertChild: (index: number, child: { id: string }) => {
        log.push(`insert:${child.id}@${index}`);
        group.children.splice(index, 0, child);
      },
    };
    const source = { id: 'S', type: 'ELLIPSE', parent: group };
    group.children.push(source);
    const standIn = {
      id: 'stand-in',
      remove: () => {
        log.push('remove:stand-in');
        group.children.splice(group.children.indexOf(standIn), 1);
      },
    };
    const ctx = {
      getNodeByIdAsync: async () => source,
      loadFontAsync: async () => {},
      createRectangle: () => standIn,
      createTextPath: () => {
        // Figma takes the shape out; with the stand-in there, the group survives.
        group.children.splice(group.children.indexOf(source), 1);
        log.push('convert');
        return { id: 'T', type: 'TEXT_PATH', name: 'Text on path' };
      },
    } as unknown as typeof figma;
    await createCreateTextPathHandler(ctx)({ nodeId: 'S', characters: 'alone' });
    expect(log).toEqual(['append:stand-in', 'convert', 'insert:T@0', 'remove:stand-in']);
    expect(group.children.map(c => (c as { id: string }).id)).toEqual(['T']);
  });
});
