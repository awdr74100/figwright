import type { GetDesignContextResult } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import { hasCutStyleIds, withLegacyStyleIds } from '../../src/tools/legacy-style-ids.js';

/** ComputeMetrics' own rounding of a serialized length. */
const sizeKb = (chars: number): number => Number((chars / 1024).toFixed(2));

const read = (inlineSizeKb: number, dedupedSizeKb = inlineSizeKb): GetDesignContextResult => ({
  nodes: [
    {
      id: '1:1',
      name: 'Card',
      type: 'FRAME',
      styleIds: { fill: 'S:a,', text: 'S:lib,1:2' },
      children: [
        {
          id: '1:2',
          name: 'Title',
          type: 'TEXT',
          // Only the style ids matter here; a run's typography is left out.
          segments: [{ characters: 'Hi', styleIds: { text: 'S:t,' } }],
        } as unknown as GetDesignContextResult['nodes'][number],
      ],
    },
  ],
  styles: {
    'S:a,': { name: 'Brand/A', type: 'PAINT' },
    'S:t,': { name: 'Body/Bold', type: 'TEXT' },
    'S:lib,1:2': { name: 'Body', type: 'TEXT' },
  },
  metrics: {
    nodeCount: 2,
    maxDepth: 2,
    styleCount: 0,
    tokenCount: 3,
    inlineSizeKb,
    dedupedSizeKb,
  },
});

describe('withLegacyStyleIds', () => {
  it('cuts local ids on nodes and runs, keeps library names, and leaves the input alone', () => {
    const input = read(50);
    const out = withLegacyStyleIds(input);
    expect(out.nodes[0]?.styleIds).toEqual({ fill: 'S:a', text: 'S:lib,1:2' });
    expect(out.nodes[0]?.children?.[0]?.segments?.[0]?.styleIds).toEqual({ text: 'S:t' });
    expect(out.styles).toEqual({ 'S:lib,1:2': { name: 'Body', type: 'TEXT' } });
    expect(input.nodes[0]?.styleIds?.fill).toBe('S:a,');
  });

  // Two local names fewer, two commas fewer (2 / 1024 KB): the metrics of the read as it was.
  it('takes the local names out of tokenCount and the commas out of the sizes', () => {
    expect(withLegacyStyleIds(read(50, 12.5)).metrics).toEqual({
      nodeCount: 2,
      maxDepth: 2,
      styleCount: 0,
      tokenCount: 1,
      inlineSizeKb: 50,
      dedupedSizeKb: 12.5,
    });
  });

  // A read of 1040 chars printed 1.02 KB; seven commas fewer it printed 1.01. Both neighbours print
  // alike here, and the nearest estimate is the one that matches (73.6% of sizes, against 67.7%
  // for always taking the upper one).
  it('takes the nearest estimate when both neighbours print alike', () => {
    const out = withLegacyStyleIds({
      ...read(1.02),
      nodes: [{ id: '1:1', name: 'n', type: 'FRAME', styleIds: { fill: 'S:a,,,,,,,' } }],
    });
    expect(out.metrics?.inlineSizeKb).toBe(1.01);
  });

  // The size guard returns this shape so that a read that fit before still fits, and only the
  // rounded new size is known — so it may differ from the old by 0.01, never print longer.
  // Sizes where the nearest estimate alone would print longer recur every ~100 chars (1,728 of
  // 175k measured up to 60k chars), so this range holds hundreds of them.
  it('never prints a size longer than the old read did', () => {
    for (let chars = 1024; chars <= 25_000; chars += 1) {
      for (const cut of [1, 41]) {
        const was = sizeKb(chars - cut);
        const got = withLegacyStyleIds({
          nodes: [
            { id: '1:1', name: 'n', type: 'FRAME', styleIds: { fill: `S:a${','.repeat(cut)}` } },
          ],
          metrics: {
            nodeCount: 1,
            maxDepth: 1,
            styleCount: 0,
            tokenCount: 0,
            inlineSizeKb: sizeKb(chars),
            dedupedSizeKb: sizeKb(chars),
          },
        }).metrics!.inlineSizeKb;
        expect(String(got).length).toBeLessThanOrEqual(String(was).length);
        expect(Math.abs(got - was)).toBeLessThanOrEqual(0.0100001);
      }
    }
  });
});

describe('hasCutStyleIds', () => {
  it('tells a capture through an older plugin from a current one', () => {
    expect(hasCutStyleIds(withLegacyStyleIds(read(1)))).toBe(true);
    expect(hasCutStyleIds(read(1))).toBe(false);
  });
});
