import { describe, expect, it } from 'vitest';

import { normalizeIdArgs, normalizeNodeId } from '../src/node-id.js';

describe('normalizeNodeId', () => {
  it('extracts and converts the node-id from a full Figma design URL', () => {
    const url =
      'https://www.figma.com/design/QuhLDuRoN6k9Tu7FUUX7Ne/My-File?node-id=17248-32218&t=abc-4';
    expect(normalizeNodeId(url)).toBe('17248:32218');
  });

  it('handles the older /file/ URL form', () => {
    expect(normalizeNodeId('https://figma.com/file/KEY/Name?node-id=1-42')).toBe('1:42');
  });

  it('converts a bare dash-form node id', () => {
    expect(normalizeNodeId('17248-32218')).toBe('17248:32218');
  });

  it('leaves a canonical colon id untouched', () => {
    expect(normalizeNodeId('17248:32218')).toBe('17248:32218');
    expect(normalizeNodeId('1:42')).toBe('1:42');
  });

  it('round-trips an instance id (I-prefix, ; segments) from its dash URL form', () => {
    // URL replaces ':' with '-' but keeps ';' and the 'I' prefix → blanket dash→colon reverses it
    expect(normalizeNodeId('I17248-32218;19656-154511')).toBe('I17248:32218;19656:154511');
  });

  it('decodes a percent-encoded node-id query value', () => {
    expect(normalizeNodeId('https://www.figma.com/design/K/N?node-id=1-2%3B3-4')).toBe('1:2;3:4');
  });

  it('returns a Figma URL without a node-id unchanged', () => {
    const url = 'https://www.figma.com/design/KEY/Name';
    expect(normalizeNodeId(url)).toBe(url);
  });

  it('never mangles a non-id string (layer name / search term)', () => {
    expect(normalizeNodeId('Header - Nav')).toBe('Header - Nav');
    expect(normalizeNodeId('icon/cart-filled')).toBe('icon/cart-filled');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeNodeId('  17248-32218  ')).toBe('17248:32218');
  });
});

describe('normalizeIdArgs', () => {
  it('normalizes nodeId in an args object, leaving other fields intact', () => {
    expect(normalizeIdArgs({ nodeId: '1-42', detail: 'full' })).toEqual({
      nodeId: '1:42',
      detail: 'full',
    });
  });

  it('normalizes parentId and a nodeIds array', () => {
    expect(normalizeIdArgs({ parentId: '5-9', nodeIds: ['1-2', '3:4', 'not-an-id name'] })).toEqual(
      { parentId: '5:9', nodeIds: ['1:2', '3:4', 'not-an-id name'] },
    );
  });

  it('returns the same reference when nothing changes (no needless clone)', () => {
    const args = { nodeId: '1:42', foo: 'bar' };
    expect(normalizeIdArgs(args)).toBe(args);
  });

  it('passes non-object args through', () => {
    expect(normalizeIdArgs(undefined)).toBeUndefined();
    expect(normalizeIdArgs('x')).toBe('x');
  });
});
