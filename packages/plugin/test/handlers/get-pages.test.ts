import type { GetPagesResult } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import { createGetPagesHandler } from '../../src/handlers/get-pages.js';

interface FakePage {
  id: string;
  name: string;
  flowStartingPoints: readonly { nodeId: string; name: string }[];
}

const fakeFigma = (pages: FakePage[]): typeof figma =>
  ({
    root: { children: pages },
  }) as unknown as typeof figma;

describe('get_pages handler', () => {
  it('returns each page with its flows, in order', async () => {
    const handler = createGetPagesHandler(
      fakeFigma([
        { id: 'p-1', name: 'Cover', flowStartingPoints: [] },
        {
          id: 'p-2',
          name: 'Details',
          flowStartingPoints: [
            { nodeId: '2:9', name: 'Checkout' },
            { nodeId: '2:1', name: 'Checkout' },
          ],
        },
      ]),
    );
    const result = (await handler(undefined)) as GetPagesResult;
    expect(result).toEqual({
      pages: [
        { id: 'p-1', name: 'Cover', flows: [] },
        {
          id: 'p-2',
          name: 'Details',
          flows: [
            { nodeId: '2:9', name: 'Checkout' },
            { nodeId: '2:1', name: 'Checkout' },
          ],
        },
      ],
    });
  });

  // Figma hands back its own objects; copying only the two documented fields keeps anything else
  // they may carry off the wire.
  it('copies only nodeId and name from each flow', async () => {
    const flow = { nodeId: '1:1', name: 'Sign up', internal: true };
    const handler = createGetPagesHandler(
      fakeFigma([{ id: 'p-1', name: 'Cover', flowStartingPoints: [flow] }]),
    );
    const result = (await handler(undefined)) as GetPagesResult;
    expect(result.pages[0]!.flows).toEqual([{ nodeId: '1:1', name: 'Sign up' }]);
  });

  it('returns empty when no pages', async () => {
    const handler = createGetPagesHandler(fakeFigma([]));
    const result = (await handler(undefined)) as GetPagesResult;
    expect(result.pages).toEqual([]);
  });
});
