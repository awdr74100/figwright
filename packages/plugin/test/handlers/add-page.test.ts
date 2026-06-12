import type { CreateResult } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import { createAddPageHandler } from '../../src/handlers/add-page.js';

const fakeFigma = (): { figma: typeof figma; page: Record<string, unknown> } => {
  const page: Record<string, unknown> = { id: 'P:1', name: 'Page 1', type: 'PAGE' };
  const figmaCtx = { createPage: () => page } as unknown as typeof figma;
  return { figma: figmaCtx, page };
};

describe('add_page handler', () => {
  it('creates a page and applies an optional name', async () => {
    const { figma: f, page } = fakeFigma();
    const result = (await createAddPageHandler(f)({ name: 'Specs' })) as CreateResult;
    expect(page.name).toBe('Specs');
    expect(result).toEqual({ ok: true, nodeId: 'P:1', name: 'Specs', type: 'PAGE' });
  });

  it('keeps the default name when none is given', async () => {
    const { figma: f } = fakeFigma();
    const result = (await createAddPageHandler(f)({})) as CreateResult;
    expect(result).toEqual({ ok: true, nodeId: 'P:1', name: 'Page 1', type: 'PAGE' });
  });
});
