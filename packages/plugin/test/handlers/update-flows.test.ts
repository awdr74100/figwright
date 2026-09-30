import type { UpdateFlowsResult } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import { createUpdateFlowsHandler } from '../../src/handlers/update-flows.js';
import { type FakeNode, makeFlowsFigma } from './flows-fake.js';

/**
 * A page "P" with four top-level frames A–D, flows on A, B and C, plus the things a flow cannot
 * start on: a frame nested in A, a rectangle, a frame on another page, and a frame in a section.
 */
const setup = () => {
  const fake = makeFlowsFigma();
  const page = fake.makePage('P', 'Screens');
  const other = fake.makePage('Q', 'Archive');
  const frame = (id: string, parent: FakeNode = page) => fake.add({ id, type: 'FRAME', parent });
  const a = frame('A');
  frame('B');
  frame('C');
  frame('D');
  frame('NESTED', a);
  fake.add({ id: 'RECT', type: 'RECTANGLE', parent: page });
  frame('ELSEWHERE', other);
  const section = fake.add({ id: 'S', type: 'SECTION', parent: page });
  frame('IN_SECTION', section);
  page.flowStartingPoints = [
    { nodeId: 'A', name: 'Sign up' },
    { nodeId: 'B', name: 'Checkout' },
    { nodeId: 'C', name: 'Checkout' },
  ];
  page.writes = 0;
  const handler = createUpdateFlowsHandler(fake.figmaCtx);
  const run = async (args: Record<string, unknown>) =>
    (await handler({ pageId: 'P', ...args })) as UpdateFlowsResult;
  return { ...fake, page, section, run };
};

describe('update_flows handler', () => {
  it('renames one of two flows sharing a name, by frame id, in place', async () => {
    const { page, run } = setup();
    const result = await run({ flows: [{ nodeId: 'C', name: 'Checkout (guest)' }] });

    expect(result).toEqual({
      ok: true,
      pageId: 'P',
      flows: [
        { nodeId: 'A', name: 'Sign up' },
        { nodeId: 'B', name: 'Checkout' },
        { nodeId: 'C', name: 'Checkout (guest)' },
      ],
    });
    expect(page.writes).toBe(1);
  });

  it('keeps a non-Latin name exactly as given', async () => {
    const { run } = setup();
    const result = await run({ flows: [{ nodeId: 'A', name: '新使用者註冊 🚀' }] });
    expect(result.flows[0]).toEqual({ nodeId: 'A', name: '新使用者註冊 🚀' });
  });

  it('appends a frame that is not yet a flow, including one inside a section', async () => {
    const { run } = setup();
    const result = await run({
      flows: [
        { nodeId: 'D', name: 'Settings' },
        { nodeId: 'IN_SECTION', name: 'Help' },
      ],
    });
    expect(result.flows.map(f => f.nodeId)).toEqual(['A', 'B', 'C', 'D', 'IN_SECTION']);
  });

  it('removes a flow and leaves every other flow where it was', async () => {
    const { run } = setup();
    const result = await run({ remove: ['B'] });
    expect(result.flows).toEqual([
      { nodeId: 'A', name: 'Sign up' },
      { nodeId: 'C', name: 'Checkout' },
    ]);
  });

  it('moves the named flows to the front and keeps the rest in their order', async () => {
    const { run } = setup();
    const result = await run({ order: ['C', 'B'] });
    expect(result.flows.map(f => f.nodeId)).toEqual(['C', 'B', 'A']);
  });

  it('applies a rename, an addition, a removal and an order in one write', async () => {
    const { page, run } = setup();
    const result = await run({
      flows: [
        { nodeId: 'A', name: 'Onboarding' },
        { nodeId: 'D', name: 'Settings' },
      ],
      remove: ['B'],
      order: ['D'],
    });
    expect(result.flows).toEqual([
      { nodeId: 'D', name: 'Settings' },
      { nodeId: 'A', name: 'Onboarding' },
      { nodeId: 'C', name: 'Checkout' },
    ]);
    expect(page.writes).toBe(1);
  });

  it('writes nothing for a call that changes nothing, and reports the list', async () => {
    const { page, run } = setup();
    expect((await run({})).flows).toHaveLength(3);
    expect((await run({ flows: [{ nodeId: 'A', name: 'Sign up' }] })).flows).toHaveLength(3);
    expect(page.writes).toBe(0);
  });

  it('reports an empty list for a page without flows', async () => {
    const { page, run } = setup();
    page.flowStartingPoints = [];
    expect((await run({})).flows).toEqual([]);
  });

  describe('refusals, which leave the page as it was', () => {
    /**
     * Run a call that must be refused on a fresh page, and report what it left behind: the error it
     * raised, and whether the page is untouched — not written to at all, not merely equal after.
     */
    const refusal = async (
      args: Record<string, unknown>,
    ): Promise<{ message: string; untouched: boolean }> => {
      const { page, run } = setup();
      const before = page.flowStartingPoints;
      const message = await run(args).then(
        () => 'resolved',
        (e: unknown) => (e as Error).message,
      );
      const same = JSON.stringify(page.flowStartingPoints) === JSON.stringify(before);
      return { message, untouched: same && page.writes === 0 };
    };

    it('a frame named in both flows and remove', async () => {
      const r = await refusal({ flows: [{ nodeId: 'A', name: 'x' }], remove: ['A'] });
      expect(r.message).toMatch(/A is in both flows and remove/);
      expect(r.untouched).toBe(true);
    });

    it('a repeated id in any argument', async () => {
      const cases: [Record<string, unknown>, RegExp][] = [
        [
          {
            flows: [
              { nodeId: 'D', name: 'x' },
              { nodeId: 'D', name: 'y' },
            ],
          },
          /flows names D more than once/,
        ],
        [{ remove: ['A', 'A'] }, /remove names A more than once/],
        [{ order: ['A', 'A'] }, /order names A more than once/],
      ];
      for (const [args, message] of cases) {
        const r = await refusal(args);
        expect(r.message).toMatch(message);
        expect(r.untouched).toBe(true);
      }
    });

    it('removing a frame that is not a flow, saying why one might not be listed', async () => {
      const r = await refusal({ remove: ['D'] });
      expect(r.message).toMatch(
        /D is not a flow starting point on page "Screens".*hidden, inside a group or nested/,
      );
      expect(r.untouched).toBe(true);
    });

    it('ordering a frame that will not be a flow', async () => {
      const notYet = await refusal({ order: ['D'] });
      expect(notYet.message).toMatch(/order names D, which is not a flow starting point/);
      expect(notYet.untouched).toBe(true);
      const removed = await refusal({ remove: ['A'], order: ['A'] });
      expect(removed.message).toMatch(/order names A/);
      expect(removed.untouched).toBe(true);
    });

    it('an empty name, naming the entry', async () => {
      const r = await refusal({ flows: [{ nodeId: 'A', name: '' }] });
      expect(r.message).toMatch(/flows\[0\]\.name must be a non-empty/);
      expect(r.untouched).toBe(true);
    });

    it('a page id that is missing or not a page', async () => {
      const { figmaCtx } = setup();
      const handler = createUpdateFlowsHandler(figmaCtx);
      await expect(handler({ pageId: 'NOPE' })).rejects.toThrow(/page NOPE not found/);
      await expect(handler({ pageId: 'A' })).rejects.toThrow(/A is a FRAME, not a page/);
    });

    // Figma takes a hidden frame without an error and keeps its entry out of sight, where it turns
    // into a flow once the frame is shown — a write afterwards cannot remove it. Refusing before the
    // write is the only way to leave nothing behind.
    it('a hidden frame — before anything is written, so nothing is left out of sight', async () => {
      const { page, nodes, run } = setup();
      nodes.get('D')!.visible = false;
      await expect(
        run({
          flows: [
            { nodeId: 'D', name: 'Hidden' },
            { nodeId: 'A', name: 'Renamed' },
          ],
        }),
      ).rejects.toThrow(/D is hidden, so the flows on page "Screens" were left unchanged/);
      expect(page.writes).toBe(0);
      expect(page.stored.some(f => f.nodeId === 'D')).toBe(false);

      nodes.get('D')!.visible = true;
      expect(page.flowStartingPoints.map(f => f.nodeId)).toEqual(['A', 'B', 'C']);
    });

    it('but not a frame whose section is hidden — Figma takes that one', async () => {
      const { section, run } = setup();
      section.visible = false;
      const result = await run({ flows: [{ nodeId: 'IN_SECTION', name: 'Help' }] });
      expect(result.flows.map(f => f.nodeId)).toContain('IN_SECTION');
    });

    it('whatever Figma refuses, naming each frame and why', async () => {
      const { page, run } = setup();
      const before = page.flowStartingPoints;
      const error = await run({
        flows: [
          { nodeId: 'D', name: 'fine' },
          { nodeId: 'GHOST', name: 'x' },
          { nodeId: 'RECT', name: 'x' },
          { nodeId: 'NESTED', name: 'x' },
          { nodeId: 'ELSEWHERE', name: 'x' },
          { nodeId: 'Q', name: 'x' },
        ],
      }).catch((e: unknown) => e as Error);

      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).toMatch(
        /Figma refused the new flow list for page "Screens", which is unchanged/,
      );
      expect(message).toContain('GHOST does not exist');
      expect(message).toContain('RECT is a RECTANGLE');
      expect(message).toContain('NESTED (FRAME) sits inside a FRAME');
      expect(message).toContain('ELSEWHERE is on page "Archive", not "Screens"');
      expect(message).toContain('Q is a PAGE');
      // The frame that was fine is not blamed.
      expect(message).not.toMatch(/\bD\b/);
      expect(page.flowStartingPoints).toEqual(before);
    });
  });

  // A flow whose frame is grouped or nested is out of sight: it cannot be addressed until the
  // frame is top-level again, and then it is back under its old name.
  it('cannot reach a flow whose frame is nested, and finds it again once it is not', async () => {
    const { page, nodes, run } = setup();
    const b = nodes.get('B')!;
    b.parent = nodes.get('A')!;
    expect((await run({})).flows.map(f => f.nodeId)).toEqual(['A', 'C']);
    await expect(run({ remove: ['B'] })).rejects.toThrow(/B is not a flow starting point/);
    await expect(run({ flows: [{ nodeId: 'B', name: 'x' }] })).rejects.toThrow(
      /B \(FRAME\) sits inside a FRAME/,
    );

    b.parent = page;
    expect((await run({})).flows).toContainEqual({ nodeId: 'B', name: 'Checkout' });
  });

  // The safety net for whatever else Figma might take without taking: read back, put the visible
  // list back, and never claim success.
  it('puts the list back and says so when Figma reads back something other than was written', async () => {
    const { page, run } = setup();
    const before = page.flowStartingPoints;
    const store = Object.getOwnPropertyDescriptor(page, 'flowStartingPoints')!;
    let writes = 0;
    Object.defineProperty(page, 'flowStartingPoints', {
      get: store.get!,
      set: (next: { nodeId: string; name: string }[]) => {
        writes += 1;
        // The first write loses its last entry; the restore goes through untouched.
        store.set!(writes === 1 ? next.slice(0, -1) : next);
      },
    });

    await expect(run({ flows: [{ nodeId: 'D', name: 'Settings' }] })).rejects.toThrow(
      /Figma accepted the list but dropped D.*were put back as they were, but Figma may still hold/,
    );
    expect(page.flowStartingPoints).toEqual(before);
    expect(writes).toBe(2);
  });
});
