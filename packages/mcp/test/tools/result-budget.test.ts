import { type SearchNodesResult, type SerializedNode } from '@figwright/shared';
import { describe, expect, it } from 'vitest';

import { assertWithinLimit, fitNodeList } from '../../src/tools/result-budget.js';

const node = (id: string, name: string): SerializedNode =>
  ({
    id,
    name,
    type: 'TEXT',
    visible: true,
    locked: false,
    x: 0,
    y: 0,
    width: 1,
    height: 1,
  }) as SerializedNode;

/** Bytes the result occupies as the text block of a JSON-RPC line — what the client buffers. */
const onWire = (result: unknown): number =>
  Buffer.byteLength(JSON.stringify(JSON.stringify(result)), 'utf8') - 2;

const HINT = 'pass root to scope it';

describe('fitNodeList', () => {
  it('returns a list that fits unchanged', () => {
    const result: SearchNodesResult = { nodes: [node('1:1', 'a'), node('1:2', 'b')] };
    expect(fitNodeList(result, HINT, onWire(result))).toBe(result);
  });

  it('keeps the leading nodes that fit, says how many matched, and leads with the note', () => {
    const nodes = Array.from({ length: 50 }, (_, i) => node(`1:${i}`, `Node ${i}`));
    const budget = onWire({ nodes }) / 2;
    const fitted = fitNodeList({ nodes }, HINT, budget);
    expect(Object.keys(fitted)).toEqual(['note', 'matchCount', 'nodes']);
    expect(fitted.matchCount).toBe(50);
    expect(fitted.nodes).toEqual(nodes.slice(0, fitted.nodes.length));
    expect(fitted.note).toContain(`first ${fitted.nodes.length} of 50 matching nodes`);
    expect(fitted.note).toContain(HINT);
    // As full as the budget allows: within it, and one more node would not be.
    expect(onWire(fitted)).toBeLessThanOrEqual(budget);
    const oneMore = { ...fitted, nodes: nodes.slice(0, fitted.nodes.length + 1) };
    expect(onWire(oneMore)).toBeGreaterThan(budget);
  });

  it('counts escaped and multi-byte text as the wire carries it', () => {
    // Quotes and backslashes double when escaped into the text block; CJK is three bytes in UTF-8.
    // Measuring characters instead would overshoot the budget on exactly these names.
    const nodes = Array.from({ length: 40 }, (_, i) => node(`1:${i}`, `按鈕 "主要" \\ ${i}`));
    const budget = Math.floor(onWire({ nodes }) * 0.6);
    const fitted = fitNodeList({ nodes }, HINT, budget);
    expect(onWire(fitted)).toBeLessThanOrEqual(budget);
    expect(onWire({ ...fitted, nodes: nodes.slice(0, fitted.nodes.length + 1) })).toBeGreaterThan(
      budget,
    );
  });

  it('keeps the total the plugin reported when it stopped serializing early', () => {
    const nodes = Array.from({ length: 10 }, (_, i) => node(`1:${i}`, 'x'.repeat(100)));
    const fitted = fitNodeList({ matchCount: 42_565, nodes }, HINT, onWire({ nodes }) / 2);
    expect(fitted.matchCount).toBe(42_565);
    expect(fitted.note).toContain('of 42,565 matching nodes');
  });

  it('still answers with the note when not even one node fits', () => {
    const fitted = fitNodeList({ nodes: [node('1:1', 'x'.repeat(10_000))] }, HINT, 1_000);
    expect(fitted.nodes).toEqual([]);
    expect(fitted.matchCount).toBe(1);
    expect(fitted.note).toContain('first 0 of 1');
  });
});

describe('assertWithinLimit', () => {
  it('passes a result under the limit through untouched', () => {
    const result = { content: [{ type: 'text' as const, text: 'x'.repeat(1_000) }] };
    expect(assertWithinLimit('get_document', result, 10_000)).toBe(result);
  });

  it('refuses a result over the limit with a message that says what to do', () => {
    const result = { content: [{ type: 'text' as const, text: 'x'.repeat(20_000) }] };
    expect(() => assertWithinLimit('get_document', result, 10_000)).toThrow(
      /get_document: the result is .* MB, more than the 10\.0 MB one MCP message can carry/,
    );
  });

  it('counts the escaped size, not the character count', () => {
    // 4,000 quotes are 4,000 characters but 8,000 bytes once escaped into the JSON-RPC line.
    const result = { content: [{ type: 'text' as const, text: '"'.repeat(4_000) }] };
    expect(() => assertWithinLimit('search_nodes', result, 6_000)).toThrow(/search_nodes/);
  });

  it('counts image data too', () => {
    const result = {
      content: [{ type: 'image' as const, data: 'A'.repeat(20_000), mimeType: 'image/png' }],
    };
    expect(() => assertWithinLimit('get_screenshot', result, 10_000)).toThrow(/get_screenshot/);
  });
});
