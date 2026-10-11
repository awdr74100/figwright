import type { ResponsiveLayoutConfig } from '@figwright/shared';

export const createResponsiveFixture = (kind: 'flex' | 'grid' | 'instances' = 'flex') => {
  const writes: { nodeId: string; field: string; value: unknown }[] = [];
  const listeners = new Map<string, Set<() => void>>();
  const saved = new Map<string, string>();
  const pending = new Map<string, Promise<void>>();
  const nodes = new Map<string, any>();
  const variables = new Map<string, any>();
  const makeNode = (id: string, type = 'FRAME', parent?: any): any => {
    const data: Record<string, any> = {
      id,
      type,
      parent: parent ?? null,
      removed: false,
      children: [],
      name: `arbitrary-${id}`,
      width: 900,
      height: 120,
      visible: true,
      layoutMode: 'HORIZONTAL',
      layoutSizingHorizontal: 'FIXED',
      layoutSizingVertical: 'FIXED',
      maxWidth: null,
      paddingTop: 0,
      paddingRight: 0,
      paddingBottom: 0,
      paddingLeft: 0,
      itemSpacing: 0,
      primaryAxisAlignItems: 'MIN',
      counterAxisAlignItems: 'MIN',
      layoutWrap: 'NO_WRAP',
      counterAxisSpacing: 0,
      counterAxisAlignContent: 'AUTO',
      boundVariables: {},
      layoutPositioning: 'AUTO',
      gridRowSpan: 1,
      gridColumnSpan: 1,
      gridRowAnchorIndex: 0,
      gridColumnAnchorIndex: 0,
      componentProperties: {
        'Flag#1': { type: 'BOOLEAN', value: false },
        Size: { type: 'VARIANT', value: 'A' },
      },
      setProperties: (values: Record<string, unknown>) => {
        writes.push({ nodeId: id, field: 'componentProperties', value: values });
        for (const [key, value] of Object.entries(values))
          data.componentProperties[key].value = value;
      },
      setBoundVariable: (field: string, v: any) => {
        writes.push({ nodeId: id, field: `binding:${field}`, value: v?.id ?? null });
        if (v === null) delete data.boundVariables[field];
        else data.boundVariables[field] = { type: 'VARIABLE_ALIAS', id: v.id };
      },
      on: (event: string, cb: () => void) => {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(cb);
      },
      off: (event: string, cb: () => void) => listeners.get(event)?.delete(cb),
    };
    const node = new Proxy(data, {
      set: (target, field, value) => {
        if (field === 'gridRowCount' && target.gridAutoTracks === 'ROWS')
          throw new Error('automatic rows');
        if (field === 'layoutMode' && value === 'GRID' && target.layoutMode === 'GRID')
          throw new Error('grid reset');
        if (
          (field === 'layoutSizingHorizontal' || field === 'layoutSizingVertical') &&
          value === 'HUG'
        ) {
          const tracks =
            field === 'layoutSizingHorizontal' ? target.gridColumnSizes : target.gridRowSizes;
          if (target.layoutMode === 'GRID' && tracks?.some((t: any) => t.type === 'FLEX'))
            throw new Error('HUG with FLEX');
        }
        writes.push({ nodeId: id, field: String(field), value });
        target[String(field)] = value;
        if (field === 'gridColumnCount' || field === 'gridRowCount') {
          const key = field === 'gridColumnCount' ? 'gridColumnSizes' : 'gridRowSizes';
          target[key] = Array.from(
            { length: value },
            (_, i) => target[key]?.[i] ?? makeTrack(id, 'FLEX', 1),
          );
        }
        if (
          target.gridAutoTracks === 'ROWS' &&
          (field === 'gridColumnCount' || field === 'gridAutoTracks')
        ) {
          const count = Math.max(1, Math.ceil(target.children.length / target.gridColumnCount));
          target.gridRowCount = count;
          target.gridRowSizes = Array.from(
            { length: count },
            (_, i) => target.gridRowSizes[i] ?? makeTrack(id, 'FLEX', 1),
          );
        }
        return true;
      },
    });
    nodes.set(id, node);
    parent?.children?.push(node);
    return node;
  };
  const makeTrack = (id: string, type: string, value = 1): any =>
    new Proxy(
      { type, value },
      {
        set: (target, field, next) => {
          writes.push({ nodeId: id, field: `track:${String(field)}`, value: next });
          Reflect.set(target, field, next);
          return true;
        },
      },
    );
  const document = {
    id: 'doc',
    type: 'DOCUMENT',
    parent: null,
    getPluginData: (key: string) => saved.get(key) ?? '',
    setPluginData: (key: string, value: string) => saved.set(key, value),
  };
  const page = makeNode('p', 'PAGE', document);
  const outer = makeNode('outer', 'FRAME', page);
  const root = makeNode('r', 'FRAME', outer);
  const frame = makeNode('f', 'FRAME', root);
  const instance = makeNode('i', 'INSTANCE', root);
  const set = {
    type: 'COMPONENT_SET',
    children: ['A', 'B'].map(Size => ({
      type: 'COMPONENT',
      variantProperties: { Size } as Record<string, string>,
    })),
  };
  const main = { type: 'COMPONENT', parent: set };
  instance.getMainComponentAsync = async () => main;
  if (kind === 'grid') {
    Object.assign(frame, {
      layoutMode: 'GRID',
      gridColumnCount: 3,
      gridRowCount: 2,
      gridColumnSizes: [
        makeTrack('f', 'FLEX', 2),
        makeTrack('f', 'FIXED', 240),
        makeTrack('f', 'FLEX', 1),
      ],
      gridRowSizes: [makeTrack('f', 'FIXED', 80), makeTrack('f', 'HUG')],
      gridAutoTracks: 'NONE',
      gridItemsPositioning: 'MANUAL',
      gridRowGap: 0,
      gridColumnGap: 0,
    });
    makeNode('a', 'RECTANGLE', frame);
    makeNode('b', 'RECTANGLE', frame).gridColumnAnchorIndex = 1;
    makeNode('c', 'RECTANGLE', frame).gridColumnAnchorIndex = 2;
  }
  const api = {
    root: document,
    currentPage: page,
    getNodeByIdAsync: async (id: string) => {
      await pending.get(id);
      return nodes.get(id) ?? null;
    },
    variables: { getVariableByIdAsync: async (id: string) => variables.get(id) ?? null },
    on: (event: string, callback: () => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(callback);
    },
    off: (event: string, callback: () => void) => listeners.get(event)?.delete(callback),
  };
  const config: ResponsiveLayoutConfig = {
    version: 1,
    pageId: 'p',
    roots: [
      {
        rootId: 'r',
        base: [],
        breakpoints: [
          { at: 'base', overrides: [] },
          { at: 'md', overrides: [] },
          { at: 'lg', overrides: [] },
        ],
      },
    ],
  };
  writes.length = 0;
  return {
    api: api as unknown as typeof figma,
    root,
    frame,
    instance,
    config,
    writes,
    nodes,
    variables,
    listeners,
    saved,
    makeNode,
    makeTrack,
    main,
    set,
    setWidth: (width: number) => {
      root.width = width;
    },
    emitChange: () => {
      for (const cb of listeners.get('nodechange') ?? []) cb();
    },
    switchPage: (id: string) => {
      api.currentPage = nodes.get(id) ?? makeNode(id, 'PAGE', document);
      for (const cb of listeners.get('currentpagechange') ?? []) cb();
    },
    deferLookup: (id: string) => {
      let release!: () => void;
      pending.set(
        id,
        new Promise<void>(r => {
          release = r;
        }),
      );
      return {
        release: () => {
          pending.delete(id);
          release();
        },
      };
    },
    flush: async () => {
      await new Promise(r => setTimeout(r, 150));
    },
  };
};
