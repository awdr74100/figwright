import { describe, expect, it, vi } from 'vitest';

import { revealNodes } from '../src/reveal.js';

interface FakeNode {
  id: string;
  type: string;
  removed?: boolean;
  parent: FakeNode | null;
}

const page = (id: string): FakeNode => ({ id, type: 'PAGE', parent: null });

const node = (id: string, parent: FakeNode | null, over: Partial<FakeNode> = {}): FakeNode => ({
  id,
  type: 'FRAME',
  removed: false,
  parent,
  ...over,
});

/**
 * A figma stub with just the surface `revealNodes` touches. `zoomAfterFit` models where Figma's own
 * `scrollAndZoomIntoView` would land — a tiny node fits at a huge zoom, a page-sized frame at a
 * small one.
 */
const fakeFigma = (nodes: FakeNode[], current: FakeNode, zoomAfterFit = 1) => {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const currentPage = { id: current.id, selection: [] as FakeNode[] };
  const viewport = {
    zoom: 1,
    scrollAndZoomIntoView: vi.fn<(n: FakeNode[]) => void>(() => {
      viewport.zoom = zoomAfterFit;
    }),
  };
  return {
    getNodeByIdAsync: vi.fn<(id: string) => Promise<FakeNode | null>>(async id =>
      Promise.resolve(byId.get(id) ?? null),
    ),
    setCurrentPageAsync: vi.fn<(p: FakeNode) => Promise<void>>(async p => {
      currentPage.id = p.id;
      return Promise.resolve();
    }),
    currentPage,
    viewport,
  };
};

// The stub models only what the function uses; casting keeps the test free of the full PluginAPI.
const asFigma = (f: ReturnType<typeof fakeFigma>): typeof figma => f as unknown as typeof figma;

const MISSED = { revealed: 0, switchedPage: false };

describe('revealNodes', () => {
  it('selects and frames the requested node', async () => {
    const p = page('p1');
    const target = node('1:1', p);
    const f = fakeFigma([p, target], p);

    const outcome = await revealNodes(asFigma(f), ['1:1']);

    expect(f.currentPage.selection).toEqual([target]);
    expect(f.viewport.scrollAndZoomIntoView).toHaveBeenCalledWith([target]);
    expect(outcome).toEqual({ revealed: 1, switchedPage: false });
  });

  it('reveals every requested node at once', async () => {
    const p = page('p1');
    const a = node('1:1', p);
    const b = node('2:2', p);
    const f = fakeFigma([p, a, b], p);

    const outcome = await revealNodes(asFigma(f), ['1:1', '2:2']);

    expect(f.currentPage.selection).toEqual([a, b]);
    expect(outcome.revealed).toBe(2);
  });

  // The agent may have deleted the node, or the user may have undone the call, since it ran.
  it('skips ids that no longer resolve', async () => {
    const p = page('p1');
    const alive = node('1:1', p);
    const f = fakeFigma([p, alive], p);

    const outcome = await revealNodes(asFigma(f), ['9:9', '1:1']);

    expect(f.currentPage.selection).toEqual([alive]);
    expect(outcome.revealed).toBe(1);
  });

  it('skips nodes that were removed', async () => {
    const p = page('p1');
    const gone = node('1:1', p, { removed: true });
    const f = fakeFigma([p, gone], p);

    const outcome = await revealNodes(asFigma(f), ['1:1']);

    expect(outcome).toEqual(MISSED);
    expect(f.viewport.scrollAndZoomIntoView).not.toHaveBeenCalled();
  });

  it('does nothing when none of the ids resolve', async () => {
    const p = page('p1');
    const f = fakeFigma([p], p);

    const outcome = await revealNodes(asFigma(f), ['9:9']);

    expect(outcome).toEqual(MISSED);
    expect(f.setCurrentPageAsync).not.toHaveBeenCalled();
    expect(f.viewport.scrollAndZoomIntoView).not.toHaveBeenCalled();
  });

  // Pages and the document itself can't be selected or zoomed to.
  it('ignores ids that point at a page or the document', async () => {
    const p = page('p1');
    const doc: FakeNode = { id: 'doc', type: 'DOCUMENT', parent: null };
    const f = fakeFigma([p, doc], p);

    const outcome = await revealNodes(asFigma(f), ['p1', 'doc']);

    expect(outcome.revealed).toBe(0);
  });

  it('switches to the page the node lives on', async () => {
    const here = page('p1');
    const there = page('p2');
    const target = node('2:1', there);
    const f = fakeFigma([here, there, target], here);

    const outcome = await revealNodes(asFigma(f), ['2:1']);

    expect(f.setCurrentPageAsync).toHaveBeenCalledWith(there);
    expect(outcome).toEqual({ revealed: 1, switchedPage: true });
  });

  // A selection can't span pages, so the first id decides which page wins.
  it('keeps only the nodes on the first node’s page', async () => {
    const p1 = page('p1');
    const p2 = page('p2');
    const first = node('1:1', p1);
    const elsewhere = node('2:2', p2);
    const f = fakeFigma([p1, p2, first, elsewhere], p1);

    const outcome = await revealNodes(asFigma(f), ['1:1', '2:2']);

    expect(f.currentPage.selection).toEqual([first]);
    expect(outcome.revealed).toBe(1);
  });

  it('finds the page through nested parents', async () => {
    const p = page('p1');
    const group = node('1:1', p, { type: 'GROUP' });
    const child = node('1:2', group);
    const f = fakeFigma([p, group, child], p);

    const outcome = await revealNodes(asFigma(f), ['1:2']);

    expect(outcome.revealed).toBe(1);
  });

  it('ignores a detached node with no page above it', async () => {
    const p = page('p1');
    const orphan = node('1:1', null);
    const f = fakeFigma([p, orphan], p);

    const outcome = await revealNodes(asFigma(f), ['1:1']);

    expect(outcome).toEqual(MISSED);
  });

  it('survives a lookup that rejects', async () => {
    const p = page('p1');
    const f = fakeFigma([p], p);
    f.getNodeByIdAsync.mockRejectedValueOnce(new Error('paging failed'));

    await expect(revealNodes(asFigma(f), ['1:1'])).resolves.toEqual(MISSED);
  });

  it('does nothing when asked for no nodes', async () => {
    const p = page('p1');
    const f = fakeFigma([p], p);

    const outcome = await revealNodes(asFigma(f), []);

    expect(outcome).toEqual(MISSED);
    expect(f.getNodeByIdAsync).not.toHaveBeenCalled();
  });

  describe('zoom', () => {
    // Fitting a small node fills the screen with it and leaves nothing to orient against, so the
    // reveal backs off far enough to keep its surroundings in frame.
    it('backs off when fitting the node would zoom in too far', async () => {
      const p = page('p1');
      const f = fakeFigma([p, node('1:1', p)], p, 12);

      await revealNodes(asFigma(f), ['1:1']);

      expect(f.viewport.zoom).toBe(4);
    });

    it('leaves a comfortable zoom alone', async () => {
      const p = page('p1');
      const f = fakeFigma([p, node('1:1', p)], p, 0.5);

      await revealNodes(asFigma(f), ['1:1']);

      expect(f.viewport.zoom).toBe(0.5);
    });

    it('leaves the zoom untouched when nothing was revealed', async () => {
      const p = page('p1');
      const f = fakeFigma([p], p, 12);

      await revealNodes(asFigma(f), ['9:9']);

      expect(f.viewport.zoom).toBe(1);
    });
  });
});
