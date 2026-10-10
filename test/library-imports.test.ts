import { describe, expect, it } from 'vitest';

import { ALL_TOOL_SPECS, WRITE_TOOL_NAMES } from '../packages/mcp/src/tools/registry.js';
import { WIRE_TOOL_SCHEMAS } from '../packages/mcp/src/tools/wire-schema.js';
import { createSandboxHandlers } from '../packages/plugin/src/handlers/registry.js';

// Only Figma's external library API is replaced. The real schemas, registry, idempotency and
// binding/apply handlers consume the imported target-file references, never a guessed source id.
const setup = () => {
  const variable = {
    id: 'VariableID:published-variable/12:34',
    key: 'published-variable',
    name: 'spacing/large',
    resolvedType: 'FLOAT',
  };
  const style = {
    id: 'S:published-style,12:35',
    key: 'published-style',
    name: 'Heading/Large',
    type: 'TEXT',
  };
  const variables = new Map<string, typeof variable>();
  const styles = new Map<string, typeof style>();
  const bindings = new Map<string, string | null>();
  let textStyleId = '';
  let variableImports = 0;
  let styleImports = 0;
  const frame = {
    id: '1:1',
    setBoundVariable: (field: string, value: typeof variable | null) => {
      if (value !== null && !variables.has(value.id)) throw new Error('Variable not imported');
      bindings.set(field, value?.id ?? null);
    },
  };
  const text = {
    id: '1:2',
    setTextStyleIdAsync: async (id: string) => {
      if (!styles.has(id)) throw new Error('Cannot find style');
      textStyleId = id;
    },
  };
  const figmaApi = {
    getNodeByIdAsync: async (id: string) =>
      id === frame.id ? frame : id === text.id ? text : null,
    variables: {
      importVariableByKeyAsync: async (key: string) => {
        variableImports += 1;
        if (key !== variable.key) throw new Error('No published variable with this key');
        variables.set(variable.id, variable);
        return variable;
      },
      getVariableByIdAsync: async (id: string) => variables.get(id) ?? null,
    },
    importStyleByKeyAsync: async (key: string) => {
      styleImports += 1;
      if (key !== style.key) throw new Error('Style is unpublished or inaccessible');
      styles.set(style.id, style);
      return style;
    },
  } as unknown as typeof figma;
  const handlers = createSandboxHandlers(figmaApi);
  const call = async (name: string, input: Record<string, unknown>, requestId?: string) => {
    const spec = ALL_TOOL_SPECS.find(tool => tool.name === name);
    expect(spec, `${name} must be advertised`).toBeDefined();
    const args = spec!.inputSchema.parse(input);
    expect(handlers[name], `${name} must be dispatched`).toBeDefined();
    return handlers[name]!({ ...args, ...(requestId === undefined ? {} : { requestId }) });
  };
  return {
    call,
    handlers,
    bindings,
    textStyleId: () => textStyleId,
    importCounts: () => ({ variables: variableImports, styles: styleImports }),
  };
};

describe('library imports', () => {
  it('returns a target-file variable id that the unchanged binding tool can use', async () => {
    const target = setup();
    const result = await target.call('import_variable', { variableKey: 'published-variable' });
    expect(result).toEqual({
      ok: true,
      variableId: 'VariableID:published-variable/12:34',
      name: 'spacing/large',
    });
    expect(target.bindings.size).toBe(0);
    await target.call('bind_variable_to_node', {
      nodeId: '1:1',
      field: 'paddingTop',
      variableId: (result as { variableId: string }).variableId,
    });
    expect(target.bindings.get('paddingTop')).toBe('VariableID:published-variable/12:34');
  });

  it('returns a target-file style id that the unchanged apply tool can use', async () => {
    const target = setup();
    const result = await target.call('import_style', { styleKey: 'published-style' });
    expect(result).toEqual({
      ok: true,
      styleId: 'S:published-style,12:35',
      name: 'Heading/Large',
    });
    expect(target.textStyleId()).toBe('');
    await target.call('apply_style_to_node', {
      nodeId: '1:2',
      field: 'text',
      styleId: (result as { styleId: string }).styleId,
    });
    expect(target.textStyleId()).toBe('S:published-style,12:35');
  });

  it.each([
    ['import_variable', { variableKey: 'unavailable' }, /No published variable/],
    ['import_style', { styleKey: 'unavailable' }, /unpublished or inaccessible/],
  ])(
    'keeps Figma failures visible for %s rather than fabricating a usable id',
    async (name, args, reason) => {
      const target = setup();
      await expect(target.call(name, args)).rejects.toThrow(reason);
      expect(target.bindings.size).toBe(0);
      expect(target.textStyleId()).toBe('');
    },
  );

  it.each([
    ['import_variable', { variableKey: 'published-variable' }, { variables: 1, styles: 0 }],
    ['import_style', { styleKey: 'published-style' }, { variables: 0, styles: 1 }],
  ])('replays a completed %s without importing again', async (name, args, counts) => {
    const target = setup();
    const first = await target.call(name, args, 'request-1');
    expect(await target.call(name, args, 'request-1')).toEqual(first);
    expect(target.importCounts()).toEqual(counts);
  });

  it.each([
    ['import_variable', 'variableKey'],
    ['import_style', 'styleKey'],
  ])(
    '%s requires an explicit non-empty key at both the MCP and sandbox boundary',
    async (name, key) => {
      const target = setup();
      const spec = ALL_TOOL_SPECS.find(tool => tool.name === name);
      expect(spec).toBeDefined();
      expect(WRITE_TOOL_NAMES.has(name)).toBe(true);
      expect(WIRE_TOOL_SCHEMAS.has(name)).toBe(true);
      for (const input of [{}, { [key]: '' }, { [key]: null }, { [key]: 123 }]) {
        expect(spec!.inputSchema.safeParse(input).success).toBe(false);
        await expect(target.handlers[name]!(input)).rejects.toThrow(/key.*non-empty string/i);
      }
      // Source ids and caller-owned retry ids are not alternative spellings of a published key.
      expect(spec!.inputSchema.safeParse({ [key]: 'key', variableId: 'source-id' }).success).toBe(
        false,
      );
      expect(spec!.inputSchema.safeParse({ [key]: 'key', requestId: 'caller-id' }).success).toBe(
        false,
      );
      expect(target.importCounts()).toEqual({ variables: 0, styles: 0 });
    },
  );

  it.each([
    ['import_variable', { variableKey: 'published-variable' }],
    ['import_style', { styleKey: 'published-style' }],
  ])(
    'refuses %s inside a batch before importing a library reference that cannot be rolled back',
    async (name, params) => {
      const target = setup();
      await expect(target.call('batch', { ops: [{ tool: name, params }] })).rejects.toThrow(
        /import.*before.*batch/i,
      );
      expect(target.importCounts()).toEqual({ variables: 0, styles: 0 });
    },
  );
});
