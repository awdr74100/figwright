/**
 * A page whose `flowStartingPoints` behaves the way Figma's was measured to (2026-10-01), for the
 * update_flows and batch tests. What a plain array would get wrong, and these tests are about:
 *
 * - The list is assigned whole and refused whole — one bad entry and nothing is written;
 * - A hidden frame is not refused: its entry is dropped from the list read back, yet kept;
 * - A flow whose frame stops qualifying (hidden, nested) is kept out of sight, not deleted, and comes
 *   back when the frame qualifies again — but a write made meanwhile loses its place, so it comes
 *   back at the end (in Figma it lands somewhere a plugin cannot choose; the end stands in for
 *   that);
 * - An entry removed by a write while its frame qualifies is gone for good.
 */

export interface FakeNode {
  id: string;
  type: string;
  name: string;
  visible: boolean;
  parent: FakeNode | null;
  [key: string]: unknown;
}

export interface FakeFlow {
  nodeId: string;
  name: string;
}

interface FlowsPage extends FakeNode {
  flowStartingPoints: FakeFlow[];
  /** Every stored entry, visible or not — the tests' view of what Figma keeps out of sight. */
  stored: FakeFlow[];
  /** How many times the list was assigned. */
  writes: number;
}

const FLOW_TYPES = new Set(['FRAME', 'COMPONENT', 'INSTANCE']);

const pageOf = (node: FakeNode): FakeNode | null => {
  let at: FakeNode | null = node;
  while (at !== null && at.type !== 'PAGE') at = at.parent;
  return at;
};

export const makeFlowsFigma = () => {
  const nodes = new Map<string, FakeNode>();
  const add = (init: {
    id: string;
    type: string;
    parent: FakeNode | null;
    name?: string;
    visible?: boolean;
    fills?: unknown[];
  }): FakeNode => {
    const full: FakeNode = { ...init, name: init.name ?? init.id, visible: init.visible ?? true };
    nodes.set(full.id, full);
    return full;
  };

  const makePage = (id: string, name: string): FlowsPage => {
    let stored: FakeFlow[] = [];
    const page = add({ id, type: 'PAGE', name, parent: null }) as FlowsPage;
    const qualifies = (nodeId: string): boolean => {
      const node = nodes.get(nodeId);
      return (
        node !== undefined &&
        pageOf(node) === page &&
        (node.parent === page || node.parent?.type === 'SECTION') &&
        FLOW_TYPES.has(node.type) &&
        node.visible
      );
    };
    Object.defineProperty(page, 'stored', { get: () => stored });
    page.writes = 0;
    Object.defineProperty(page, 'flowStartingPoints', {
      configurable: true,
      get: () =>
        stored.filter(f => qualifies(f.nodeId)).map(f => ({ nodeId: f.nodeId, name: f.name })),
      set: (next: FakeFlow[]) => {
        const ids = next.map(f => f.nodeId);
        if (new Set(ids).size !== ids.length) {
          throw new Error('in set_flowStartingPoints: Found duplicate input nodeIds');
        }
        for (const f of next) {
          if (f.name.length === 0) {
            throw new Error(
              'in set_flowStartingPoints: Can only set flow starting point with non-empty name',
            );
          }
          const node = nodes.get(f.nodeId);
          if (node === undefined) {
            throw new Error(
              'in set_flowStartingPoints: Can only set flow starting point with valid nodeId',
            );
          }
          if (pageOf(node) !== page && node.type !== 'PAGE') {
            throw new Error(
              'in set_flowStartingPoints: Can only set flow starting point on associated page',
            );
          }
          // A hidden frame passes: that is the whole point of modelling it.
          const topLevel = node.parent === page || node.parent?.type === 'SECTION';
          if (!topLevel || !FLOW_TYPES.has(node.type)) {
            throw new Error(
              'in set_flowStartingPoints: Can only set flow starting point that is a top level ' +
                'frame and a valid prototype source (no groups nor immutable or invisible frames)',
            );
          }
        }
        const named = new Set(ids);
        const outOfSight = stored.filter(f => !named.has(f.nodeId) && !qualifies(f.nodeId));
        stored = [...next.map(f => ({ nodeId: f.nodeId, name: f.name })), ...outOfSight];
        page.writes += 1;
      },
    });
    return page;
  };

  const figmaCtx = {
    getNodeByIdAsync: async (id: string) => nodes.get(id) ?? null,
  } as unknown as typeof figma;

  return { figmaCtx, nodes, add, makePage };
};
