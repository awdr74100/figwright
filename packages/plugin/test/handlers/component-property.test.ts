import type { ComponentPropertyResult, MutateResult } from '@figwright/shared';
import { describe, expect, it, vi } from 'vitest';

import { createAddComponentPropertyHandler } from '../../src/handlers/add-component-property.js';
import { createBindComponentPropertyHandler } from '../../src/handlers/bind-component-property.js';
import { createDeleteComponentPropertyHandler } from '../../src/handlers/delete-component-property.js';
import { createEditComponentPropertyHandler } from '../../src/handlers/edit-component-property.js';

/** A figma stub whose getNodeByIdAsync resolves from a fixed id → node map. */
const fakeFigma = (nodes: Record<string, unknown>): typeof figma =>
  ({ getNodeByIdAsync: async (id: string) => nodes[id] ?? null }) as unknown as typeof figma;

describe('add_component_property handler', () => {
  it('declares a BOOLEAN property and returns its assigned id', async () => {
    const addComponentProperty = vi.fn<(n: string, t: string, d: unknown) => string>(
      name => `${name}#4:2`,
    );
    const comp = { id: 'C:1', type: 'COMPONENT', parent: null, addComponentProperty };
    const handler = createAddComponentPropertyHandler(fakeFigma({ 'C:1': comp }));
    const r = (await handler({
      componentId: 'C:1',
      name: 'Show Icon',
      type: 'BOOLEAN',
      defaultValue: true,
    })) as ComponentPropertyResult;

    expect(addComponentProperty).toHaveBeenCalledWith('Show Icon', 'BOOLEAN', true, undefined);
    expect(r).toEqual({
      ok: true,
      componentId: 'C:1',
      propertyId: 'Show Icon#4:2',
      name: 'Show Icon',
    });
  });

  it('passes preferredValues through for an INSTANCE_SWAP property', async () => {
    const addComponentProperty = vi.fn<(n: string, t: string, d: unknown, o: unknown) => string>(
      name => `${name}#4:3`,
    );
    const comp = { id: 'C:1', type: 'COMPONENT', parent: null, addComponentProperty };
    const handler = createAddComponentPropertyHandler(fakeFigma({ 'C:1': comp }));
    await handler({
      componentId: 'C:1',
      name: 'Icon',
      type: 'INSTANCE_SWAP',
      defaultValue: 'abc123',
      preferredValues: [{ type: 'COMPONENT', key: 'k1' }],
    });
    expect(addComponentProperty).toHaveBeenCalledWith('Icon', 'INSTANCE_SWAP', 'abc123', {
      preferredValues: [{ type: 'COMPONENT', key: 'k1' }],
    });
  });

  it('rejects a defaultValue that does not match the type, and preferredValues off INSTANCE_SWAP', async () => {
    const comp = {
      id: 'C:1',
      type: 'COMPONENT',
      parent: null,
      addComponentProperty: vi.fn<() => string>(),
    };
    const handler = createAddComponentPropertyHandler(fakeFigma({ 'C:1': comp }));
    await expect(
      handler({ componentId: 'C:1', name: 'X', type: 'BOOLEAN', defaultValue: 'nope' }),
    ).rejects.toThrow(/BOOLEAN property needs a boolean/);
    await expect(
      handler({
        componentId: 'C:1',
        name: 'X',
        type: 'TEXT',
        defaultValue: 'hi',
        preferredValues: [{ type: 'COMPONENT', key: 'k' }],
      }),
    ).rejects.toThrow(/preferredValues is only valid for an INSTANCE_SWAP/);
  });

  it('resolves a variant component to its set, and refuses an instance', async () => {
    const set = {
      id: 'S:1',
      type: 'COMPONENT_SET',
      addComponentProperty: vi.fn<() => string>(() => 'P#1'),
    };
    const variant = { id: 'C:1', type: 'COMPONENT', parent: set };
    const instance = { id: 'I:1', type: 'INSTANCE' };
    const handler = createAddComponentPropertyHandler(
      fakeFigma({ 'C:1': variant, 'I:1': instance }),
    );
    const r = (await handler({
      componentId: 'C:1',
      name: 'P',
      type: 'BOOLEAN',
      defaultValue: false,
    })) as ComponentPropertyResult;
    expect(r.componentId).toBe('S:1'); // authored on the set, not the variant
    expect(set.addComponentProperty).toHaveBeenCalled();
    await expect(
      handler({ componentId: 'I:1', name: 'P', type: 'BOOLEAN', defaultValue: false }),
    ).rejects.toThrow(/is an INSTANCE — author properties on its main component/);
  });
});

describe('bind_component_property handler', () => {
  const boolDef = { 'Show Icon#4:2': { type: 'BOOLEAN', defaultValue: true } };

  it('binds a BOOLEAN property to a layer visible reference', async () => {
    const comp = {
      id: 'C:1',
      type: 'COMPONENT',
      parent: null,
      componentPropertyDefinitions: boolDef,
    };
    const layer = { id: 'L:1', type: 'FRAME', parent: comp, componentPropertyReferences: null };
    const handler = createBindComponentPropertyHandler(fakeFigma({ 'L:1': layer }));
    const r = (await handler({
      nodeId: 'L:1',
      field: 'visible',
      propertyId: 'Show Icon#4:2',
    })) as MutateResult;
    expect(r).toEqual({ ok: true, nodeId: 'L:1' });
    expect(layer.componentPropertyReferences).toEqual({ visible: 'Show Icon#4:2' });
  });

  it('finds a property defined on the variant set above the layer', async () => {
    const set = { id: 'S:1', type: 'COMPONENT_SET', componentPropertyDefinitions: boolDef };
    // Figma throws when componentPropertyDefinitions is read on a variant, so the fake does too.
    const variant = {
      id: 'C:1',
      type: 'COMPONENT',
      parent: set,
      get componentPropertyDefinitions(): never {
        throw new Error(
          'in get_componentPropertyDefinitions: Can only get component property definitions of a component set or non-variant component',
        );
      },
    };
    const layer = { id: 'L:1', type: 'FRAME', parent: variant, componentPropertyReferences: null };
    const handler = createBindComponentPropertyHandler(fakeFigma({ 'L:1': layer }));
    await handler({ nodeId: 'L:1', field: 'visible', propertyId: 'Show Icon#4:2' });
    expect(layer.componentPropertyReferences).toEqual({ visible: 'Show Icon#4:2' });
  });

  it('rejects a field that does not fit the node type', async () => {
    const comp = {
      id: 'C:1',
      type: 'COMPONENT',
      parent: null,
      componentPropertyDefinitions: boolDef,
    };
    const layer = { id: 'L:1', type: 'FRAME', parent: comp, componentPropertyReferences: null };
    const handler = createBindComponentPropertyHandler(fakeFigma({ 'L:1': layer }));
    await expect(
      handler({ nodeId: 'L:1', field: 'characters', propertyId: 'Show Icon#4:2' }),
    ).rejects.toThrow(/field "characters" requires a TEXT node/);
  });

  it('rejects a property whose type does not match the field', async () => {
    const swapDef = { 'Icon#4:5': { type: 'INSTANCE_SWAP', defaultValue: 'k' } };
    const comp = {
      id: 'C:1',
      type: 'COMPONENT',
      parent: null,
      componentPropertyDefinitions: swapDef,
    };
    const layer = { id: 'L:1', type: 'FRAME', parent: comp, componentPropertyReferences: null };
    const handler = createBindComponentPropertyHandler(fakeFigma({ 'L:1': layer }));
    // INSTANCE_SWAP binds to mainComponent, so binding it to visible must fail.
    await expect(
      handler({ nodeId: 'L:1', field: 'visible', propertyId: 'Icon#4:5' }),
    ).rejects.toThrow(/binds to "mainComponent", not "visible"/);
  });

  it('rejects a property id not present on the containing component', async () => {
    const comp = { id: 'C:1', type: 'COMPONENT', parent: null, componentPropertyDefinitions: {} };
    const layer = { id: 'L:1', type: 'FRAME', parent: comp, componentPropertyReferences: null };
    const handler = createBindComponentPropertyHandler(fakeFigma({ 'L:1': layer }));
    await expect(
      handler({ nodeId: 'L:1', field: 'visible', propertyId: 'Ghost#9:9' }),
    ).rejects.toThrow(/not found on the containing component/);
  });

  it('unbinds a field when propertyId is null', async () => {
    const comp = {
      id: 'C:1',
      type: 'COMPONENT',
      parent: null,
      componentPropertyDefinitions: boolDef,
    };
    const layer = {
      id: 'L:1',
      type: 'FRAME',
      parent: comp,
      componentPropertyReferences: { visible: 'Show Icon#4:2' },
    };
    const handler = createBindComponentPropertyHandler(fakeFigma({ 'L:1': layer }));
    await handler({ nodeId: 'L:1', field: 'visible', propertyId: null });
    expect(layer.componentPropertyReferences).toEqual({});
  });
});

describe('edit_component_property handler', () => {
  it('renames a property and returns the new id + parsed name', async () => {
    const editComponentProperty = vi.fn<(id: string, v: { name?: string }) => string>(
      (_id, v) => `${v.name}#4:2`,
    );
    const comp = {
      id: 'C:1',
      type: 'COMPONENT',
      parent: null,
      componentPropertyDefinitions: { 'Show Icon#4:2': { type: 'BOOLEAN', defaultValue: true } },
      editComponentProperty,
    };
    const handler = createEditComponentPropertyHandler(fakeFigma({ 'C:1': comp }));
    const r = (await handler({
      componentId: 'C:1',
      propertyId: 'Show Icon#4:2',
      name: 'Show Badge',
    })) as ComponentPropertyResult;
    expect(editComponentProperty).toHaveBeenCalledWith('Show Icon#4:2', { name: 'Show Badge' });
    expect(r).toMatchObject({ propertyId: 'Show Badge#4:2', name: 'Show Badge' });
  });

  it('requires at least one change and a real property id', async () => {
    const comp = {
      id: 'C:1',
      type: 'COMPONENT',
      parent: null,
      componentPropertyDefinitions: { 'P#1:1': { type: 'BOOLEAN', defaultValue: true } },
      editComponentProperty: vi.fn<() => string>(),
    };
    const handler = createEditComponentPropertyHandler(fakeFigma({ 'C:1': comp }));
    await expect(handler({ componentId: 'C:1', propertyId: 'P#1:1' })).rejects.toThrow(
      /at least one of name/,
    );
    await expect(
      handler({ componentId: 'C:1', propertyId: 'Ghost#9:9', name: 'x' }),
    ).rejects.toThrow(/not found on/);
  });
});

describe('an INSTANCE_SWAP default Figma refuses', () => {
  // Figma's two refusals there (measured, add and edit alike, local and library components). Neither
  // names the value or the fix, so the handlers say both — without refusing anything Figma accepts.
  const FIGMA =
    'in addComponentProperty: Property value is incompatible with component property type';
  const INVALID =
    'in addComponentProperty: Default value for instance swap component property is invalid';
  const KEY = '16a3f27010593935bc931d44671379fa63744801';
  const refusing = (): (() => string) => () => {
    throw new Error(FIGMA);
  };
  const invalid = (): (() => string) => () => {
    throw new Error(INVALID);
  };

  it('says the default is the component node id when add is refused for a key', async () => {
    const comp = { id: 'C:1', type: 'COMPONENT', parent: null, addComponentProperty: refusing() };
    const handler = createAddComponentPropertyHandler(fakeFigma({ 'C:1': comp }));
    const refused = handler({
      componentId: 'C:1',
      name: 'Icon',
      type: 'INSTANCE_SWAP',
      defaultValue: KEY,
    });
    await expect(refused).rejects.toThrow(
      `add_component_property: ${FIGMA} — defaultValue "${KEY}" is a component key; an ` +
        "INSTANCE_SWAP default takes the component's node id",
    );
    // A library component's key is refused as well, and its id is the imported copy's — which
    // get_local_components does not list, so the hint says where that one is found.
    await expect(refused).rejects.toThrow(
      /library component's is the mainComponent id of an instance of it/,
    );
  });

  it('says what an id must name when Figma calls it invalid (an instance from "$N" included)', async () => {
    // Same words for an instance, a frame, a component set, a missing id and the component itself.
    const comp = { id: 'C:1', type: 'COMPONENT', parent: null, addComponentProperty: invalid() };
    const handler = createAddComponentPropertyHandler(fakeFigma({ 'C:1': comp }));
    await expect(
      handler({ componentId: 'C:1', name: 'Icon', type: 'INSTANCE_SWAP', defaultValue: '12:7' }),
    ).rejects.toThrow(
      `add_component_property: ${INVALID} — defaultValue "12:7" is not a component this one can ` +
        "default to; it takes a COMPONENT's node id — not an instance (use its mainComponent id",
    );
  });

  it('says the same when edit is refused as invalid', async () => {
    const comp = {
      id: 'C:1',
      type: 'COMPONENT',
      parent: null,
      componentPropertyDefinitions: { 'Icon#1:2': { type: 'INSTANCE_SWAP', defaultValue: '1:9' } },
      editComponentProperty: () => {
        throw new Error(INVALID.replace('addComponentProperty', 'editComponentProperty'));
      },
    };
    const handler = createEditComponentPropertyHandler(fakeFigma({ 'C:1': comp }));
    await expect(
      handler({ componentId: 'C:1', propertyId: 'Icon#1:2', defaultValue: '12:7' }),
    ).rejects.toThrow(/edit_component_property: .*is invalid — defaultValue "12:7" is not a/);
  });

  it('leaves Figma\'s "invalid" alone on a property that is not INSTANCE_SWAP', async () => {
    const comp = { id: 'C:1', type: 'COMPONENT', parent: null, addComponentProperty: invalid() };
    const handler = createAddComponentPropertyHandler(fakeFigma({ 'C:1': comp }));
    await expect(
      handler({ componentId: 'C:1', name: 'Label', type: 'TEXT', defaultValue: '12:7' }),
    ).rejects.toThrow(new RegExp(`^${INVALID}$`));
  });

  it('says the same when edit is refused for a key', async () => {
    const comp = {
      id: 'C:1',
      type: 'COMPONENT',
      parent: null,
      componentPropertyDefinitions: { 'Icon#1:2': { type: 'INSTANCE_SWAP', defaultValue: '1:9' } },
      editComponentProperty: refusing(),
    };
    const handler = createEditComponentPropertyHandler(fakeFigma({ 'C:1': comp }));
    await expect(
      handler({ componentId: 'C:1', propertyId: 'Icon#1:2', defaultValue: KEY }),
    ).rejects.toThrow(/edit_component_property: .*is a component key; an INSTANCE_SWAP default/);
  });

  it('leaves every other refusal exactly as Figma raised it', async () => {
    const comp = { id: 'C:1', type: 'COMPONENT', parent: null, addComponentProperty: refusing() };
    const handler = createAddComponentPropertyHandler(fakeFigma({ 'C:1': comp }));
    // Not key-shaped: a node id that does not exist, say.
    await expect(
      handler({ componentId: 'C:1', name: 'Icon', type: 'INSTANCE_SWAP', defaultValue: '9:9' }),
    ).rejects.toThrow(new RegExp(`^${FIGMA}$`));
    // Key-shaped, but TEXT: forty hex digits are just text there.
    await expect(
      handler({ componentId: 'C:1', name: 'Hash', type: 'TEXT', defaultValue: KEY }),
    ).rejects.toThrow(new RegExp(`^${FIGMA}$`));
  });

  it('passes a key straight to Figma, so a kind it accepts still works', async () => {
    const addComponentProperty = vi.fn<(n: string, t: string, d: unknown) => string>(
      name => `${name}#4:3`,
    );
    const comp = { id: 'C:1', type: 'COMPONENT', parent: null, addComponentProperty };
    const handler = createAddComponentPropertyHandler(fakeFigma({ 'C:1': comp }));
    await handler({ componentId: 'C:1', name: 'Icon', type: 'INSTANCE_SWAP', defaultValue: KEY });
    expect(addComponentProperty).toHaveBeenCalledWith('Icon', 'INSTANCE_SWAP', KEY, undefined);
  });
});

describe('delete_component_property handler', () => {
  it('deletes a property and returns its parsed name', async () => {
    const deleteComponentProperty = vi.fn<(id: string) => void>();
    const comp = {
      id: 'C:1',
      type: 'COMPONENT',
      parent: null,
      componentPropertyDefinitions: { 'Show Icon#4:2': { type: 'BOOLEAN', defaultValue: true } },
      deleteComponentProperty,
    };
    const handler = createDeleteComponentPropertyHandler(fakeFigma({ 'C:1': comp }));
    const r = (await handler({
      componentId: 'C:1',
      propertyId: 'Show Icon#4:2',
    })) as ComponentPropertyResult;
    expect(deleteComponentProperty).toHaveBeenCalledWith('Show Icon#4:2');
    expect(r).toEqual({
      ok: true,
      componentId: 'C:1',
      propertyId: 'Show Icon#4:2',
      name: 'Show Icon',
    });
  });

  it('refuses to delete a VARIANT property', async () => {
    const comp = {
      id: 'C:1',
      type: 'COMPONENT_SET',
      componentPropertyDefinitions: { Size: { type: 'VARIANT', defaultValue: 'M' } },
      deleteComponentProperty: vi.fn<() => void>(),
    };
    const handler = createDeleteComponentPropertyHandler(fakeFigma({ 'C:1': comp }));
    await expect(handler({ componentId: 'C:1', propertyId: 'Size' })).rejects.toThrow(
      /is a VARIANT property/,
    );
  });
});
