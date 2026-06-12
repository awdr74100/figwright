import type { ScanTextNodesResult } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import { createScanTextNodesHandler } from '../../src/handlers/scan-text-nodes.js';

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
});
