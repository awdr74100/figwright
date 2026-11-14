import { describe, expect, it } from 'vitest';

import {
  batchHasRefs,
  batchRefOrderError,
  batchRefResultKeys,
  findBatchRefs,
  findOpRefs,
  parseBatchRef,
  resolveBatchRefs,
} from '../src/batch-refs.js';

describe('parseBatchRef', () => {
  it('reads "$N" and "$N.key"', () => {
    expect(parseBatchRef('$0')).toEqual({ index: 0, key: undefined });
    expect(parseBatchRef('$12')).toEqual({ index: 12, key: undefined });
    expect(parseBatchRef('$3.defaultModeId')).toEqual({ index: 3, key: 'defaultModeId' });
  });

  it('reads nothing else as one', () => {
    for (const s of [
      '$',
      '$-1',
      '$01',
      '$1.',
      '$1.2x',
      '$1.a.b',
      ' $1',
      '$1 ',
      'x$1',
      '1:2',
      '$a',
    ]) {
      expect({ s, ref: parseBatchRef(s) }).toEqual({ s, ref: null });
    }
    expect(parseBatchRef(0)).toBeNull();
    expect(parseBatchRef(null)).toBeNull();
  });
});

describe('findBatchRefs — where a reference is read', () => {
  it('reads id-shaped keys at any depth, and the root of a text search', () => {
    const sites = findBatchRefs({
      parentId: '$0',
      root: '$1',
      reactions: [{ actions: [{ destinationId: '$2' }] }],
      ranges: [{ textStyleId: '$3.styleId' }],
    });
    expect(sites.map(s => [s.path, s.field, s.value])).toEqual([
      ['params.parentId', 'parentId', '$0'],
      ['params.root', 'root', '$1'],
      ['params.reactions[0].actions[0].destinationId', 'destinationId', '$2'],
      ['params.ranges[0].textStyleId', 'textStyleId', '$3.styleId'],
    ]);
  });

  it('reads each entry of an id list', () => {
    const sites = findBatchRefs({ nodeIds: ['1:2', '$0', '$4'] });
    expect(sites.map(s => [s.path, s.field])).toEqual([
      ['params.nodeIds[1]', 'nodeIds'],
      ['params.nodeIds[2]', 'nodeIds'],
    ]);
  });

  it('reads a variable alias id and every boundVariables value as a variable id', () => {
    const sites = findBatchRefs({
      value: { type: 'VARIABLE_ALIAS', id: '$0' },
      fills: [{ type: 'SOLID', boundVariables: { color: '$1' } }],
      boundVariables: { 'font-size': '$2' },
    });
    expect(sites.map(s => [s.path, s.field])).toEqual([
      ['params.value.id', 'variableId'],
      ['params.fills[0].boundVariables.color', 'variableId'],
      ['params.boundVariables["font-size"]', 'variableId'],
    ]);
  });

  it('never reads text, names, or an `id` that is not a variable alias', () => {
    const params = {
      characters: '$5',
      name: '$0',
      description: '$1.nodeId',
      properties: { 'Label#1:2': '$0' },
      track: { id: '$0', keyframes: [{ id: '$1' }] },
      codeSyntax: { WEB: '$0' },
      labels: ['$0'],
    };
    expect(findBatchRefs(params)).toEqual([]);
  });

  it('leaves a real id alone', () => {
    expect(findBatchRefs({ nodeId: '1:2', nodeIds: ['I1:2;3:4'], styleId: 'S:abc,1:2' })).toEqual(
      [],
    );
  });
});

describe('batchRefResultKeys', () => {
  it('reads the id an argument asks for', () => {
    for (const f of ['nodeId', 'parentId', 'newParentId', 'nodeIds', 'root', 'pageId']) {
      expect({ f, keys: batchRefResultKeys(f) }).toEqual({ f, keys: ['nodeId'] });
    }
    expect(batchRefResultKeys('componentId')).toEqual(['nodeId', 'componentId']);
    expect(batchRefResultKeys('modeId')).toEqual(['modeId', 'defaultModeId']);
    expect(batchRefResultKeys('variableModeId')).toEqual(['modeId', 'defaultModeId']);
    expect(batchRefResultKeys('variableCollectionId')).toEqual(['collectionId']);
    expect(batchRefResultKeys('textStyleId')).toEqual(['styleId']);
    expect(batchRefResultKeys('fillStyleId')).toEqual(['styleId']);
    expect(batchRefResultKeys('variableId')).toEqual(['variableId']);
    expect(batchRefResultKeys('propertyId')).toEqual(['propertyId']);
  });
});

describe('resolveBatchRefs', () => {
  const tools = ['create_frame', 'create_variable_collection', 'add_variable_mode', 'create_text'];
  const results = [
    { ok: true, nodeId: '9:1', name: 'Card', type: 'FRAME' },
    { ok: true, collectionId: 'VariableCollectionId:1:0', defaultModeId: '1:0', name: 'C' },
    { ok: true, modeId: '1:1', name: 'Dark' },
  ];

  it('puts each id where its reference was', () => {
    const out = resolveBatchRefs(
      {
        parentId: '$0',
        nodeIds: ['$0', '7:7'],
        collectionId: '$1',
        modeId: '$1',
        variableModeId: '$2',
        other: { modeId: '$1.defaultModeId' },
        characters: '$0',
      },
      3,
      results,
      tools,
    );
    expect(out).toEqual({
      parentId: '9:1',
      nodeIds: ['9:1', '7:7'],
      collectionId: 'VariableCollectionId:1:0',
      // A new collection has no `modeId`, so a bare reference reads its default mode.
      modeId: '1:0',
      variableModeId: '1:1',
      other: { modeId: '1:0' },
      characters: '$0',
    });
  });

  it('hands back the very same object when there is nothing to resolve', () => {
    const params = { nodeId: '1:2', fills: [{ type: 'SOLID', boundVariables: { color: 'V:1' } }] };
    expect(resolveBatchRefs(params, 1, results, tools)).toBe(params);
  });

  it('does not touch the caller’s arguments', () => {
    const params = { nodeIds: ['$0'], fills: [{ boundVariables: { color: '$0.nodeId' } }] };
    const before = JSON.parse(JSON.stringify(params)) as unknown;
    resolveBatchRefs(params, 1, results, tools);
    expect(params).toEqual(before);
  });

  it('names what the earlier result does carry when it lacks the id asked for', () => {
    expect(() => resolveBatchRefs({ nodeId: '$1' }, 3, results, tools)).toThrow(
      'batch ops[3]: params.nodeId is "$1", but op 1 (create_variable_collection) returned no ' +
        'nodeId — name one of its ids instead: "$1.collectionId", "$1.defaultModeId"',
    );
    expect(() => resolveBatchRefs({ nodeId: '$0.styleId' }, 3, results, tools)).toThrow(
      'returned no styleId — name one of its ids instead: "$0.nodeId"',
    );
  });

  it('says so when the earlier op returns no id at all', () => {
    expect(() =>
      resolveBatchRefs({ nodeId: '$0' }, 1, [{ ok: true, affected: ['1:2'] }], ['move_nodes']),
    ).toThrow(
      'batch ops[1]: params.nodeId is "$0", but op 0 (move_nodes) returned no nodeId — it ' +
        'returns no id to refer to',
    );
  });

  it('refuses a reference to an op that has not run', () => {
    expect(() => resolveBatchRefs({ nodeId: '$3' }, 3, results, tools)).toThrow(
      'but op 3 has not run',
    );
  });
});

describe('batchRefOrderError', () => {
  it('accepts references to earlier ops', () => {
    expect(
      batchRefOrderError([{ params: {} }, { params: { parentId: '$0' } }, { params: {} }]),
    ).toBeNull();
  });

  it('refuses one naming its own op or a later one, before anything runs', () => {
    expect(batchRefOrderError([{ params: { nodeId: '$0' } }])).toBe(
      'batch ops[0]: params.nodeId is "$0", which names op 0 (this op) — a reference can only ' +
        'name an earlier op in the batch, whose result exists by the time this one runs',
    );
    expect(batchRefOrderError([{ params: { nodeIds: ['$2'] } }, {}, {}])).toContain(
      'which names op 2 — ',
    );
  });

  it('ignores "$N" outside id positions', () => {
    expect(batchRefOrderError([{ params: { characters: '$9' } }])).toBeNull();
  });

  it('takes a property id naming this op or a later one as the VARIANT name it can only be', () => {
    // Measured on the first build of this: a batch whose first op renames a VARIANT called `$0` —
    // a call that worked before references — was refused as misordered.
    const rename = {
      tool: 'edit_component_property',
      params: { componentId: '1:2', propertyId: '$0', name: 'Size' },
    };
    expect(batchRefOrderError([rename])).toBeNull();
    expect(
      batchRefOrderError([
        { tool: 'rename_node', params: { nodeId: '1:3', name: 'x' } },
        { ...rename, params: { ...rename.params, propertyId: '$5' } },
      ]),
    ).toBeNull();
    // Every other id position still refuses it.
    expect(
      batchRefOrderError([
        { tool: 'edit_component_property', params: { componentId: '$0', propertyId: 'Size' } },
      ]),
    ).toContain('names op 0 (this op)');
  });
});

describe('findOpRefs', () => {
  const at = (tool: string, params: unknown, i: number) =>
    findOpRefs({ tool, params }, i).map(site => site.path);

  it('reads a component property id as a reference only when it names an earlier op', () => {
    for (const tool of [
      'edit_component_property',
      'bind_component_property',
      'delete_component_property',
    ]) {
      expect(at(tool, { propertyId: '$0' }, 1)).toEqual(['params.propertyId']);
      expect(at(tool, { propertyId: '$1' }, 1)).toEqual([]);
      expect(at(tool, { propertyId: '$0' }, 0)).toEqual([]);
    }
  });

  it('never reads a Motion keyframe field id as one — no op returns an id it could take', () => {
    const field = { type: 'INDEXED_ITEM', collection: 'fills', index: 0, propertyId: '$0' };
    expect(at('apply_manual_keyframe_track', { nodeId: '$0', field }, 3)).toEqual([
      'params.nodeId',
    ]);
  });

  it('reads every other id position as findBatchRefs does', () => {
    const params = { parentId: '$0', fills: [{ boundVariables: { color: '$1' } }] };
    expect(at('create_frame', params, 2)).toEqual(findBatchRefs(params).map(site => site.path));
  });
});

describe('batchHasRefs', () => {
  it('finds a reference in any op', () => {
    expect(batchHasRefs({ ops: [{ params: {} }, { params: { parentId: '$0' } }] })).toBe(true);
    expect(batchHasRefs({ ops: [{ params: { characters: '$0' } }] })).toBe(false);
    expect(batchHasRefs({ ops: [{}] })).toBe(false);
    expect(batchHasRefs({})).toBe(false);
    expect(batchHasRefs(null)).toBe(false);
  });

  it('does not count a property id — an older plugin reads it as a name, and fails loudly if not one', () => {
    // A VARIANT called `$0` must still reach an older plugin; a property id meant as a reference
    // makes every component-property handler since 0.3.0 throw "not found", rolling the batch back.
    const ops = [
      {
        tool: 'add_component_property',
        params: { componentId: '1:2', name: 'Label', type: 'TEXT', defaultValue: 'x' },
      },
      {
        tool: 'edit_component_property',
        params: { componentId: '1:2', propertyId: '$0', name: 'y' },
      },
    ];
    expect(batchHasRefs({ ops })).toBe(false);
    expect(
      batchHasRefs({
        ops: [
          ...ops,
          {
            tool: 'bind_component_property',
            params: { nodeId: '$0', propertyId: '$0', field: 'characters' },
          },
        ],
      }),
    ).toBe(true);
  });
});
