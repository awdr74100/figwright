import type { ScanTextNodesResult } from '@figwright/shared';
import { describe, expect, it, vi } from 'vitest';

import { createScanTextNodesHandler } from '../../src/handlers/scan-text-nodes.js';

// Every Date.now() read advances a fake clock by 1ms, so a time slice ends after a fixed number of
// reads instead of after however much work this machine fits into 40 real milliseconds.
const tickingClock = (): { mockRestore: () => void } => {
  let now = 0;
  return vi.spyOn(Date, 'now').mockImplementation(() => (now += 1));
};

const fake = (
  id: string,
  type: string,
  extra: Record<string, unknown> = {},
  children?: SceneNode[],
): SceneNode =>
  ({
    id,
    name: id,
    type,
    visible: true,
    locked: false,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    parent: { id: 'root' },
    children,
    ...extra,
  }) as unknown as SceneNode;

const fakeFigma = (pageChildren: SceneNode[]): typeof figma =>
  ({
    currentPage: { children: pageChildren },
    getNodeByIdAsync: async () => null,
  }) as unknown as typeof figma;

describe('scan_text_nodes handler', () => {
  it('collects every TEXT node in the subtree with text mixin', async () => {
    const page = [
      fake('1:1', 'FRAME', {}, [
        fake('1:2', 'TEXT', {
          characters: 'Hi',
          fontSize: 14,
          fontName: { family: 'Inter', style: 'Regular' },
        }),
        fake('1:3', 'RECTANGLE'),
      ]),
      fake('1:4', 'TEXT', {
        characters: 'Bye',
        fontSize: 12,
        fontName: { family: 'Inter', style: 'Bold' },
      }),
    ];
    const handler = createScanTextNodesHandler(fakeFigma(page));
    const result = (await handler({})) as ScanTextNodesResult;
    expect(result.nodes.map(n => n.id)).toEqual(['1:2', '1:4']);
    expect(result.nodes[0]?.characters).toBe('Hi');
    expect(result.nodes[0]?.fontName).toEqual({ family: 'Inter', style: 'Regular' });
  });

  it('returns empty when the page has no text', async () => {
    const handler = createScanTextNodesHandler(fakeFigma([fake('1:1', 'RECTANGLE')]));
    const result = (await handler(undefined)) as ScanTextNodesResult;
    expect(result.nodes).toEqual([]);
  });

  it('hands the thread back to Figma mid-scan without losing text, style, or order', async () => {
    const fontName = { family: 'Inter', style: 'Regular' };
    const texts = Array.from({ length: 1025 }, (_, index) =>
      fake(`2:${index}`, 'TEXT', { fontName, fontSize: 14, characters: `Text ${index}` }),
    );
    const handler = createScanTextNodesHandler(fakeFigma(texts));
    const clock = tickingClock();
    try {
      let finished = false;
      const read = Promise.resolve(handler({})).then(result => {
        finished = true;
        return result as ScanTextNodesResult;
      });
      const finishedWhenHostRan = await new Promise<boolean>(resolve =>
        setTimeout(() => resolve(finished), 0),
      );
      expect(finishedWhenHostRan).toBe(false);
      const result = await read;
      expect(result.nodes.map(node => node.id)).toEqual(texts.map(node => node.id));
      expect(result.nodes.map(node => node.characters)).toEqual(
        texts.map((_, index) => `Text ${index}`),
      );
      expect(result.nodes.every(node => node.fontSize === 14)).toBe(true);
      expect(result.nodes.map(node => node.fontName)).toEqual(texts.map(() => fontName));
    } finally {
      clock.mockRestore();
    }
  });

  it('stops at what one result can carry and says how many matched in all', async () => {
    // 1 MiB of text per node: the limit (just under 10 MiB) is certainly passed by the tenth.
    const texts = Array.from({ length: 40 }, (_, index) =>
      fake(`2:${index}`, 'TEXT', { characters: 'x'.repeat(1024 * 1024) }),
    );
    const result = (await createScanTextNodesHandler(fakeFigma(texts))({})) as ScanTextNodesResult;
    expect(result.matchCount).toBe(40);
    expect(result.nodes.length).toBeGreaterThanOrEqual(10);
    expect(result.nodes.length).toBeLessThan(40);
    expect(result.nodes.map(node => node.id)).toEqual(
      texts.slice(0, result.nodes.length).map(node => node.id),
    );
  });
});
