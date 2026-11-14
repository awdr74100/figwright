import { describe, expect, it } from 'vitest';

import { opNeedsEarlierResults, resolveOpRefs } from '../../src/handlers/batch-refs.js';

const fakeFigma = (nodes: Record<string, unknown>): typeof figma =>
  ({ getNodeByIdAsync: async (id: string) => nodes[id] ?? null }) as unknown as typeof figma;

const instance = (properties: Record<string, { type: string; value: unknown }>) => ({
  id: 'I1',
  type: 'INSTANCE',
  componentProperties: properties,
});

const tools = ['create_component', 'add_component_property', 'create_frame'];
const results = [
  { ok: true, nodeId: '5:1', name: 'Icon', type: 'COMPONENT' },
  { ok: true, componentId: '5:9', propertyId: 'Icon#5:20', name: 'Icon' },
  { ok: true, nodeId: '5:30', name: 'F', type: 'FRAME' },
];

describe('opNeedsEarlierResults', () => {
  it('defers an op with a reference in an id position', () => {
    expect(opNeedsEarlierResults({ tool: 'rename_node', params: { nodeId: '$0' } }, 1)).toBe(true);
    expect(opNeedsEarlierResults({ tool: 'rename_node', params: { nodeId: '1:2' } }, 1)).toBe(
      false,
    );
  });

  it('defers set_instance_properties for a key or value that could name an earlier op', () => {
    const op = (properties: Record<string, unknown>) => ({
      tool: 'set_instance_properties',
      params: { instanceId: 'I1', properties },
    });
    expect(opNeedsEarlierResults(op({ $1: 'x' }), 2)).toBe(true);
    expect(opNeedsEarlierResults(op({ 'Icon#5:20': '$0' }), 2)).toBe(true);
    // Not an earlier op, so it can only be text — and the op is captured up front as before.
    expect(opNeedsEarlierResults(op({ 'Label#1:2': '$5' }), 2)).toBe(false);
    expect(opNeedsEarlierResults(op({ 'Label#1:2': 'Sign in' }), 2)).toBe(false);
  });

  it('never defers a text value of another tool', () => {
    expect(
      opNeedsEarlierResults({ tool: 'set_text', params: { nodeId: '1:2', characters: '$0' } }, 3),
    ).toBe(false);
  });
});

describe('resolveOpRefs — component properties', () => {
  it('resolves a set_instance_properties key to the property an earlier op declared', async () => {
    const figmaCtx = fakeFigma({
      I1: instance({ 'Icon#5:20': { type: 'INSTANCE_SWAP', value: '' } }),
    });
    const out = await resolveOpRefs(
      figmaCtx,
      { tool: 'set_instance_properties', params: { instanceId: 'I1', properties: { $1: '$0' } } },
      3,
      results,
      tools,
    );
    // The key names the property; INSTANCE_SWAP makes the value a component id.
    expect(out).toEqual({ instanceId: 'I1', properties: { 'Icon#5:20': '5:1' } });
  });

  it('keeps a key that is a real property of that literal name', async () => {
    const figmaCtx = fakeFigma({ I1: instance({ $1: { type: 'VARIANT', value: 'a' } }) });
    const params = { instanceId: 'I1', properties: { $1: 'b' } };
    const out = await resolveOpRefs(
      figmaCtx,
      { tool: 'set_instance_properties', params },
      3,
      results,
      tools,
    );
    expect(out).toBe(params);
  });

  it('keeps a TEXT value that reads like a reference as the text it is', async () => {
    const figmaCtx = fakeFigma({ I1: instance({ 'Price#1:2': { type: 'TEXT', value: '' } }) });
    const params = { instanceId: 'I1', properties: { 'Price#1:2': '$0' } };
    const out = await resolveOpRefs(
      figmaCtx,
      { tool: 'set_instance_properties', params },
      3,
      results,
      tools,
    );
    expect(out).toBe(params);
  });

  it('refuses a key that resolves onto a property the call also sets by name', async () => {
    const figmaCtx = fakeFigma({ I1: instance({ 'Icon#5:20': { type: 'BOOLEAN', value: true } }) });
    await expect(
      resolveOpRefs(
        figmaCtx,
        {
          tool: 'set_instance_properties',
          params: { instanceId: 'I1', properties: { $1: true, 'Icon#5:20': false } },
        },
        3,
        results,
        tools,
      ),
    ).rejects.toThrow('the key "$1" names property "Icon#5:20", which this call already sets');
  });

  it('reads an edit_component_property propertyId as a variant name when the component has it', async () => {
    const set = {
      id: 'S1',
      type: 'COMPONENT_SET',
      parent: null,
      componentPropertyDefinitions: { $1: { type: 'VARIANT' } },
    };
    const params = { componentId: 'S1', propertyId: '$1', name: 'Size' };
    const out = await resolveOpRefs(
      fakeFigma({ S1: set }),
      { tool: 'edit_component_property', params },
      3,
      results,
      tools,
    );
    expect(out).toBe(params);
  });

  it('resolves an edit_component_property propertyId the component does not have', async () => {
    const component = {
      id: '5:9',
      type: 'COMPONENT',
      parent: null,
      componentPropertyDefinitions: { 'Icon#5:20': { type: 'INSTANCE_SWAP' } },
    };
    const out = await resolveOpRefs(
      fakeFigma({ '5:9': component }),
      {
        tool: 'edit_component_property',
        params: { componentId: '$1.componentId', propertyId: '$1', name: 'Glyph' },
      },
      3,
      results,
      tools,
    );
    expect(out).toEqual({ componentId: '5:9', propertyId: 'Icon#5:20', name: 'Glyph' });
  });

  it('resolves an INSTANCE_SWAP defaultValue to the component node an earlier op made', async () => {
    // Figma takes the component's node id there (a key is refused — measured).
    const out = await resolveOpRefs(
      fakeFigma({}),
      {
        tool: 'add_component_property',
        params: { componentId: '$2', name: 'Icon', type: 'INSTANCE_SWAP', defaultValue: '$0' },
      },
      3,
      results,
      tools,
    );
    expect(out).toEqual({
      componentId: '5:30',
      name: 'Icon',
      type: 'INSTANCE_SWAP',
      defaultValue: '5:1',
    });
  });

  it('keeps a TEXT defaultValue that reads like a reference', async () => {
    const params = { componentId: '5:9', name: 'Price', type: 'TEXT', defaultValue: '$0' };
    const op = { tool: 'add_component_property', params };
    expect(opNeedsEarlierResults(op, 3)).toBe(false);
    expect(await resolveOpRefs(fakeFigma({}), op, 3, results, tools)).toBe(params);
  });

  it('resolves an edit_component_property defaultValue only for an INSTANCE_SWAP property', async () => {
    const component = {
      id: '5:9',
      type: 'COMPONENT',
      parent: null,
      componentPropertyDefinitions: {
        'Icon#5:20': { type: 'INSTANCE_SWAP' },
        'Price#5:21': { type: 'TEXT' },
      },
    };
    const figmaCtx = fakeFigma({ '5:9': component });
    const swap = await resolveOpRefs(
      figmaCtx,
      {
        tool: 'edit_component_property',
        params: { componentId: '5:9', propertyId: 'Icon#5:20', defaultValue: '$0' },
      },
      3,
      results,
      tools,
    );
    expect(swap).toMatchObject({ defaultValue: '5:1' });
    const text = { componentId: '5:9', propertyId: 'Price#5:21', defaultValue: '$0' };
    expect(
      await resolveOpRefs(
        figmaCtx,
        { tool: 'edit_component_property', params: text },
        3,
        results,
        tools,
      ),
    ).toBe(text);
  });
});

describe('a property id that cannot be a reference', () => {
  it('passes a VARIANT name naming this op or a later one on untouched, without deferring', async () => {
    // Measured on the first build of this: a batch whose first op renames a VARIANT called `$0` —
    // which worked before references — was refused. The component is not even looked up.
    const op = {
      tool: 'edit_component_property',
      params: { componentId: '1:2', propertyId: '$0', name: 'Size' },
    };
    expect(opNeedsEarlierResults(op, 0)).toBe(false);
    const out = await resolveOpRefs(fakeFigma({}), op, 0, [], []);
    expect(out).toBe(op.params);
    const later = { ...op, params: { ...op.params, propertyId: '$7' } };
    expect(await resolveOpRefs(fakeFigma({}), later, 2, results, tools)).toBe(later.params);
  });

  it('never resolves a Motion keyframe field id, so Figma gets exactly what it always did', async () => {
    const op = {
      tool: 'apply_manual_keyframe_track',
      params: {
        nodeId: '1:2',
        field: { type: 'INDEXED_ITEM', collection: 'fills', index: 0, propertyId: '$1' },
      },
    };
    expect(opNeedsEarlierResults(op, 3)).toBe(false);
    expect(await resolveOpRefs(fakeFigma({}), op, 3, results, tools)).toBe(op.params);
  });
});

describe('a property id reference that names no property', () => {
  it('says it is neither a property of the component nor one the earlier op declared', async () => {
    // Either reading could have been meant. Before references, a missing name was "not found"; the
    // shared error would offer the earlier op's other ids (`"$2.nodeId"`), none of them a property.
    const figmaCtx = fakeFigma({
      '5:9': { id: '5:9', type: 'COMPONENT', parent: null, componentPropertyDefinitions: {} },
    });
    const op = {
      tool: 'edit_component_property',
      params: { componentId: '5:9', propertyId: '$2', name: 'x' },
    };
    await expect(resolveOpRefs(figmaCtx, op, 3, results, tools)).rejects.toThrow(
      'batch ops[3]: params.propertyId is "$2", which is not a property of the component ' +
        '(get_component_api lists the current ids), and op 2 (create_frame) declared no property ' +
        'for it to refer to',
    );
  });
});
