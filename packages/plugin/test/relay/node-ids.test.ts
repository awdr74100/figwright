import { describe, expect, it } from 'vitest';

import { extractNodeIds } from '../../ui/relay/node-ids.js';

describe('extractNodeIds', () => {
  it('finds the single node a call targets', () => {
    expect(extractNodeIds({ nodeId: '1:23', fills: [] })).toEqual(['1:23']);
  });

  it('finds every node in a multi-node call', () => {
    expect(extractNodeIds({ nodeIds: ['1:2', '3:4'] })).toEqual(['1:2', '3:4']);
  });

  it('accepts ids of nodes nested inside an instance', () => {
    expect(extractNodeIds({ nodeId: 'I422:1234;422:1200' })).toEqual(['I422:1234;422:1200']);
  });

  // The id of a newly created node is only in the result — that's exactly the call you want to jump
  // to, so params and result are both scanned.
  it('finds the node a create call returned', () => {
    const params = { name: 'Card', width: 100 };
    const result = { ok: true, nodeId: '9:9', name: 'Card', type: 'FRAME' };
    expect(extractNodeIds(params, result)).toEqual(['9:9']);
  });

  it('leads with the targeted node, then the created one', () => {
    expect(extractNodeIds({ nodeId: '1:1' }, { ok: true, nodeId: '2:2' })).toEqual(['1:1', '2:2']);
  });

  it('reaches into the nested operations of a batch', () => {
    const params = {
      operations: [
        { method: 'set_fills', params: { nodeId: '1:1' } },
        { method: 'resize_nodes', params: { nodeIds: ['2:2', '3:3'] } },
      ],
    };
    expect(extractNodeIds(params)).toEqual(['1:1', '2:2', '3:3']);
  });

  it('de-duplicates a node touched more than once', () => {
    expect(extractNodeIds({ nodeId: '1:1' }, { nodeId: '1:1' })).toEqual(['1:1']);
  });

  it('ignores values under the key that are not ids', () => {
    expect(extractNodeIds({ nodeId: 'selection' })).toEqual([]);
    expect(extractNodeIds({ nodeId: '' })).toEqual([]);
    expect(extractNodeIds({ nodeId: 42 })).toEqual([]);
  });

  // Only keys that name the operation's subject count; a parent or component reference is context,
  // not what the call acted on.
  it('ignores ids under other keys', () => {
    expect(extractNodeIds({ parentId: '1:1', componentId: '2:2', instanceId: '3:3' })).toEqual([]);
  });

  it('survives values that are not objects at all', () => {
    expect(extractNodeIds(null, undefined, 'text', 7, [])).toEqual([]);
  });

  it('caps how many ids one call can contribute', () => {
    const many = Array.from({ length: 200 }, (_, i) => `1:${i}`);
    expect(extractNodeIds({ nodeIds: many })).toHaveLength(50);
  });

  // A cyclic or pathologically deep payload must not hang the panel.
  it('stops at a depth floor instead of recursing forever', () => {
    const deep: Record<string, unknown> = {};
    let cursor = deep;
    for (let i = 0; i < 30; i++) {
      const next: Record<string, unknown> = {};
      cursor.child = next;
      cursor = next;
    }
    cursor.nodeId = '9:9';

    expect(() => extractNodeIds(deep)).not.toThrow();
    expect(extractNodeIds(deep)).toEqual([]);
  });
});
