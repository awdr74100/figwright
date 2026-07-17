import { describe, expect, it } from 'vitest';

import { normalizeIdArgs, normalizeNodeId, STRING_ID_FIELDS } from '../src/node-id.js';
import { ALL_TOOL_SPECS } from '../src/tools/registry.js';

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

  it('normalizes every canvas-id field a tool exposes, not just nodeId/parentId', () => {
    // Each of these is a real tool arg (swap_component.instanceId, create_instance.componentId,
    // search_nodes.root, navigate_to_page.pageId, …) where a pasted URL / dash id must also work.
    expect(
      normalizeIdArgs({
        instanceId: '1-2',
        componentId: 'https://www.figma.com/design/KEY/Name?node-id=3-4',
        root: '5-6',
        rootId: '7-8',
        pageId: '0-1',
        newParentId: '9-10',
        fromNodeId: '11-12',
      }),
    ).toEqual({
      instanceId: '1:2',
      componentId: '3:4',
      root: '5:6',
      rootId: '7:8',
      pageId: '0:1',
      newParentId: '9:10',
      fromNodeId: '11:12',
    });
  });

  it('never rewrites non-canvas id namespaces (style / variable / key ids)', () => {
    const args = {
      styleId: 'S:abc123,',
      variableId: 'VariableID:1:23',
      componentKey: 'a1b2c3d4',
      propertyId: 'Show Icon#12:5',
    };
    expect(normalizeIdArgs(args)).toBe(args); // untouched, same reference
  });

  it('returns the same reference when nothing changes (no needless clone)', () => {
    const args = { nodeId: '1:42', foo: 'bar' };
    expect(normalizeIdArgs(args)).toBe(args);
  });

  it('passes non-object args through', () => {
    expect(normalizeIdArgs(undefined)).toBeUndefined();
    expect(normalizeIdArgs('x')).toBe('x');
  });

  it('covers every top-level canvas-id arg any advertised tool exposes', () => {
    // normalizeIdArgs rewrites pasted Figma URLs / dash ids only for the fields in
    // STRING_ID_FIELDS (+ the nodeIds array). A new tool introducing e.g. `targetId` without
    // listing it would silently skip normalization — so every *Id-shaped top-level field must be
    // classified: either a canvas node id (listed in STRING_ID_FIELDS) or a non-canvas id
    // namespace (allowlisted below, never URL-pasteable). Nested ids stay out of scope by design.
    const NON_CANVAS_ID_FIELDS = new Set([
      'styleId', // shared-style ids (S:…)
      'variableId', // variable ids (VariableID:…)
      'collectionId', // variable-collection ids
      'propertyId', // component-property handles (name#id)
      'modeId', // variable-mode ids
      'animationStyleId', // Motion applied-style instance ids
      'timelineId', // Motion timeline ids
    ]);
    const covered = new Set<string>([...STRING_ID_FIELDS, 'nodeIds']);
    const offenders: string[] = [];
    for (const spec of ALL_TOOL_SPECS) {
      for (const key of Object.keys(spec.inputShape)) {
        const idShaped = /Ids?$/.test(key) || key === 'root';
        if (!idShaped || NON_CANVAS_ID_FIELDS.has(key)) continue;
        if (!covered.has(key)) offenders.push(`${spec.name}.${key}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
