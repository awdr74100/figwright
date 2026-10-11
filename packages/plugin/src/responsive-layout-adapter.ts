import { evaluateResponsiveRoot } from '@figwright/shared';
import type {
  ResolvedResponsiveLayoutConfig,
  ResolvedResponsiveRoot,
  ResponsiveAction,
  ResponsiveEvaluation,
  ResponsiveGridValues,
  ResponsiveLayoutValues,
  ResponsiveTrack,
} from '@figwright/shared';

import { withInstanceIdLookup } from './node-lookup.js';

export class ResponsiveRootError extends Error {
  constructor(
    readonly rootId: string,
    readonly phase: 'resolve' | 'validate' | 'apply',
    message: string,
    readonly nodeId?: string,
  ) {
    super(message);
    this.name = 'ResponsiveRootError';
  }
}
export interface PreparedResponsiveRoot {
  readonly root: FrameNode;
}
interface PreparedData {
  api: typeof figma;
  rule: ResolvedResponsiveRoot;
  pageId: string;
  nodes: Map<string, SceneNode>;
  variables: Map<string, Variable>;
  variants: Map<string, ReadonlyArray<ComponentNode>>;
}
const preparedData = new WeakMap<PreparedResponsiveRoot, PreparedData>();
const protectedTypes = new Set(['INSTANCE', 'COMPONENT', 'COMPONENT_SET']);
const fail = (rootId: string, nodeId: string, message: string): never => {
  throw new ResponsiveRootError(rootId, 'validate', message, nodeId);
};
const hasAncestor = (node: BaseNode, ancestor: BaseNode): boolean => {
  for (let parent: BaseNode | null = node; parent !== null; parent = parent.parent)
    if (parent === ancestor) return true;
  return false;
};
export const validateResponsiveRootIsolation = (
  root: FrameNode,
  roots: readonly (BaseNode | null)[],
): void => {
  if (
    roots.some(
      other =>
        other !== null &&
        other !== root &&
        !other.removed &&
        (hasAncestor(other, root) || hasAncestor(root, other)),
    )
  )
    fail(root.id, root.id, 'Responsive roots cannot overlap');
};
const checkSafe = (node: BaseNode, root: FrameNode, pageId: string): void => {
  if (node.removed || root.removed || !hasAncestor(node, root))
    fail(root.id, node.id, 'Target was removed or moved outside its root');
  if (protectedTypes.has(node.type) && node.type !== 'INSTANCE')
    fail(root.id, node.id, 'Component definitions are protected');
  let page: BaseNode | null = null;
  for (let parent = node.parent; parent !== null; parent = parent.parent) {
    if (protectedTypes.has(parent.type))
      fail(root.id, node.id, 'Component and instance internals are protected');
    if (parent.type === 'PAGE') page = parent;
  }
  if (page?.id !== pageId) fail(root.id, node.id, 'Target does not belong to the configured page');
  if (root.type !== 'FRAME' || root.layoutSizingHorizontal === 'HUG')
    fail(root.id, root.id, 'Root must be an ordinary, non-horizontal-HUG FRAME');
};
const lookup = async (api: typeof figma, rootId: string, id: string): Promise<SceneNode> => {
  const node = await api.getNodeByIdAsync(id);
  if (node === null || node.type === 'PAGE' || node.type === 'DOCUMENT')
    throw new ResponsiveRootError(rootId, 'resolve', 'Scene node not found', id);
  return node;
};

export const validateResponsiveOwnership = async (
  api: typeof figma,
  resolved: ResolvedResponsiveLayoutConfig,
): Promise<void> => {
  const ctx = withInstanceIdLookup(api);
  const roots = await Promise.all(
    resolved.roots.map(async rule => {
      const node = await lookup(ctx, rule.rootId, rule.rootId);
      if (node.type !== 'FRAME') fail(rule.rootId, node.id, 'Root must be a FRAME');
      return node as FrameNode;
    }),
  );
  await Promise.all(
    roots.map(async (root, i) => {
      checkSafe(root, root, resolved.config.pageId);
      validateResponsiveRootIsolation(root, roots);
      await Promise.all(
        resolved.roots[i]!.base.map(async action =>
          checkSafe(await lookup(ctx, root.id, action.nodeId), root, resolved.config.pageId),
        ),
      );
    }),
  );
};

const layoutOf = (node: FrameNode, actions: ResponsiveAction[]): ResponsiveLayoutValues =>
  actions.find(
    (a): a is Extract<ResponsiveAction, { type: 'layout' }> =>
      a.nodeId === node.id && a.type === 'layout',
  )?.values ?? {};
const validateLayout = (
  node: FrameNode,
  values: ResponsiveLayoutValues,
  actions: ResponsiveAction[],
  rootId: string,
): void => {
  if (node.type !== 'FRAME') fail(rootId, node.id, 'Layout targets must be ordinary FRAMEs');
  if (
    node.id === rootId &&
    (values.layoutSizingHorizontal !== undefined || values.maxWidth !== undefined)
  )
    fail(rootId, node.id, 'Rules cannot control their width source');
  for (const field of Object.keys(values))
    if (!(field in node)) fail(rootId, node.id, `Runtime does not support ${field}`);
  const mode = values.layoutMode ?? node.layoutMode;
  if (values.layoutMode !== undefined && !['HORIZONTAL', 'VERTICAL'].includes(node.layoutMode))
    fail(rootId, node.id, 'Direction changes require an existing flex layout');
  const flex = mode === 'HORIZONTAL' || mode === 'VERTICAL';
  const flexFields: (keyof ResponsiveLayoutValues)[] = [
    'itemSpacing',
    'primaryAxisAlignItems',
    'counterAxisAlignItems',
    'layoutWrap',
    'counterAxisSpacing',
    'counterAxisAlignContent',
  ];
  if (!flex && flexFields.some(field => values[field] !== undefined))
    fail(rootId, node.id, 'Flex fields require HORIZONTAL or VERTICAL');
  if (
    (values.counterAxisAlignItems ?? node.counterAxisAlignItems) === 'BASELINE' &&
    mode !== 'HORIZONTAL'
  )
    fail(rootId, node.id, 'BASELINE requires horizontal layout');
  if (
    (values.counterAxisSpacing !== undefined || values.counterAxisAlignContent !== undefined) &&
    (values.layoutWrap ?? node.layoutWrap) !== 'WRAP'
  )
    fail(rootId, node.id, 'Wrap spacing/content require WRAP');
  for (const field of ['layoutSizingHorizontal', 'layoutSizingVertical'] as const) {
    const sizing = values[field];
    if (sizing === 'HUG' && mode === 'NONE') fail(rootId, node.id, 'HUG requires auto layout');
    if (sizing === 'FILL') {
      const parent = node.parent;
      if (
        parent === null ||
        parent.type !== 'FRAME' ||
        (layoutOf(parent, actions).layoutMode ?? parent.layoutMode) === 'NONE'
      )
        fail(rootId, node.id, 'FILL requires an auto-layout parent');
    }
  }
};

const validateProperties = (
  node: InstanceNode,
  values: Record<string, string | boolean>,
  variants: ReadonlyArray<ComponentNode>,
  rootId: string,
): void => {
  if (node.type !== 'INSTANCE')
    fail(rootId, node.id, 'Public properties require a complete INSTANCE');
  const wanted: Record<string, string> = {};
  for (const [key, entry] of Object.entries(node.componentProperties))
    if (entry.type === 'VARIANT') wanted[key] = String(entry.value);
  for (const [key, value] of Object.entries(values)) {
    const entry = node.componentProperties[key];
    if (
      entry === undefined ||
      (entry.type !== 'BOOLEAN' && entry.type !== 'VARIANT') ||
      (entry.type === 'BOOLEAN' ? typeof value !== 'boolean' : typeof value !== 'string')
    )
      fail(rootId, node.id, `Unsupported public property ${key}`);
    if (entry?.type === 'VARIANT') wanted[key] = String(value);
  }
  if (
    Object.keys(wanted).length > 0 &&
    !variants.some(
      v =>
        !v.removed &&
        Object.entries(wanted).every(([key, value]) => v.variantProperties?.[key] === value),
    )
  )
    fail(rootId, node.id, 'Variant combination does not exist');
};
const spacingFields = new Set([
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'itemSpacing',
  'counterAxisSpacing',
  'gridRowGap',
  'gridColumnGap',
]);
const gridOf = (node: FrameNode, actions: ResponsiveAction[]): ResponsiveGridValues =>
  actions.find(
    (a): a is Extract<ResponsiveAction, { type: 'grid' }> =>
      a.nodeId === node.id && a.type === 'grid',
  )?.values ?? {};
const growingGridAxes = (node: FrameNode, values: ResponsiveGridValues) => {
  const columns = values.columns?.length ?? node.gridColumnCount;
  const autoRows = (values.gridAutoTracks ?? node.gridAutoTracks) === 'ROWS';
  const autoFlow = (values.gridItemsPositioning ?? node.gridItemsPositioning) === 'ROW_AUTO_FLOW';
  const automaticRows = (columnCount: number): number =>
    autoFlow
      ? Math.max(1, Math.ceil(node.children.length / columnCount))
      : node.children.reduce(
          (count, n) =>
            Math.max(
              count,
              'gridRowAnchorIndex' in n && 'gridRowSpan' in n
                ? n.gridRowAnchorIndex + n.gridRowSpan
                : node.gridRowCount,
            ),
          1,
        );
  const strategyChanges =
    (values.gridAutoTracks !== undefined && values.gridAutoTracks !== node.gridAutoTracks) ||
    (values.gridItemsPositioning !== undefined &&
      values.gridItemsPositioning !== node.gridItemsPositioning);
  const rows = autoRows
    ? Math.max(automaticRows(columns), strategyChanges ? automaticRows(node.gridColumnCount) : 0)
    : (values.rows?.length ?? node.gridRowCount);
  return {
    layoutSizingHorizontal: columns > node.gridColumnCount,
    layoutSizingVertical: rows > node.gridRowCount,
  };
};
const validateGrid = (
  node: FrameNode,
  values: ResponsiveGridValues,
  actions: ResponsiveAction[],
  rootId: string,
): void => {
  if (node.type !== 'FRAME' || node.layoutMode !== 'GRID')
    fail(rootId, node.id, 'GRID requires an existing ordinary GRID FRAME');
  const required = [
    'gridAutoTracks',
    'gridItemsPositioning',
    'gridColumnCount',
    'gridRowCount',
    'gridColumnSizes',
    'gridRowSizes',
  ];
  if (required.some(field => !(field in node)))
    fail(rootId, node.id, 'Runtime lacks GRID capabilities');
  const auto = values.gridAutoTracks ?? node.gridAutoTracks;
  const positioning = values.gridItemsPositioning ?? node.gridItemsPositioning;
  if (!['NONE', 'ROWS'].includes(auto) || !['MANUAL', 'ROW_AUTO_FLOW'].includes(positioning))
    fail(rootId, node.id, 'Unsupported GRID strategy');
  if (values.gridAutoTracks === 'ROWS' && values.autoRowTrack === undefined)
    fail(rootId, node.id, 'ROWS must explicitly own autoRowTrack');
  if (auto === 'ROWS' && values.rows !== undefined)
    fail(rootId, node.id, 'Automatic rows cannot declare manual rows');
  if (auto !== 'ROWS' && values.autoRowTrack !== undefined)
    fail(rootId, node.id, 'autoRowTrack requires ROWS');
  const reflow =
    values.gridItemsPositioning === 'ROW_AUTO_FLOW' ||
    (values.columns !== undefined &&
      positioning === 'ROW_AUTO_FLOW' &&
      values.columns.length !== node.gridColumnCount);
  if (reflow) {
    if (values.gridItemsPositioning !== 'ROW_AUTO_FLOW')
      fail(rootId, node.id, 'Automatic reflow must be explicitly configured');
    if (
      node.children.some(
        n =>
          !('layoutPositioning' in n) ||
          !('gridRowSpan' in n) ||
          !('gridColumnSpan' in n) ||
          n.layoutPositioning === 'ABSOLUTE' ||
          n.gridRowSpan !== 1 ||
          n.gridColumnSpan !== 1,
      )
    )
      fail(rootId, node.id, 'Automatic reflow supports only single-cell non-absolute children');
  } else if (values.columns !== undefined || values.rows !== undefined) {
    const columns = values.columns?.length ?? node.gridColumnCount;
    const rows = values.rows?.length ?? node.gridRowCount;
    if (
      node.children.some(
        n =>
          !('gridColumnAnchorIndex' in n) ||
          !('gridColumnSpan' in n) ||
          !('gridRowAnchorIndex' in n) ||
          !('gridRowSpan' in n) ||
          n.gridColumnAnchorIndex + n.gridColumnSpan > columns ||
          n.gridRowAnchorIndex + n.gridRowSpan > rows,
      )
    )
      fail(rootId, node.id, 'Track change would delete occupied cells');
  }
  const layout = layoutOf(node, actions);
  const growing = growingGridAxes(node, values);
  for (const field of ['layoutSizingHorizontal', 'layoutSizingVertical'] as const)
    if (node[field] === 'HUG' && growing[field] && layout[field] === undefined)
      fail(rootId, node.id, 'Growing a HUG axis requires explicit sizing ownership');
  for (const [field, tracks] of [
    ['layoutSizingHorizontal', values.columns ?? node.gridColumnSizes],
    [
      'layoutSizingVertical',
      values.autoRowTrack === undefined
        ? (values.rows ?? node.gridRowSizes)
        : [values.autoRowTrack],
    ],
  ] as const) {
    if ((layout[field] ?? node[field]) === 'HUG' && tracks.some(t => t.type === 'FLEX'))
      fail(rootId, node.id, 'HUG axes cannot contain FLEX tracks');
  }
  for (const field of ['gridRowGap', 'gridColumnGap'] as const)
    if (values[field] !== undefined && !(field in node))
      fail(rootId, node.id, `Runtime lacks ${field}`);
};
const validateActions = (
  data: PreparedData,
  root: FrameNode,
  actions: ResponsiveAction[],
): void => {
  checkSafe(root, root, data.pageId);
  for (const action of actions) {
    const node = data.nodes.get(action.nodeId)!;
    checkSafe(node, root, data.pageId);
    if (action.type === 'layout')
      validateLayout(node as FrameNode, action.values, actions, root.id);
    if (
      action.type === 'grid' ||
      (action.type === 'layout' && (node as FrameNode).layoutMode === 'GRID')
    )
      validateGrid(node as FrameNode, gridOf(node as FrameNode, actions), actions, root.id);
    if (action.type === 'componentProperties')
      validateProperties(
        node as InstanceNode,
        action.values,
        data.variants.get(node.id) ?? [],
        root.id,
      );
    if (action.type === 'layout' || action.type === 'grid')
      for (const [field, value] of Object.entries(action.values)) {
        if (!spacingFields.has(field)) continue;
        const spacing = value as { value: number; variableId?: string };
        if (spacing.variableId !== undefined) {
          const variable = data.variables.get(spacing.variableId);
          const resolved = variable?.resolveForConsumer(node);
          if (
            variable?.resolvedType !== 'FLOAT' ||
            resolved?.resolvedType !== 'FLOAT' ||
            resolved.value !== spacing.value
          )
            fail(
              root.id,
              node.id,
              `Variable for ${field} does not resolve to the declared FLOAT value`,
            );
        }
      }
  }
};

export const prepareResponsiveRoot = async (
  api: typeof figma,
  rule: ResolvedResponsiveRoot,
  pageId: string,
): Promise<PreparedResponsiveRoot> => {
  const ctx = withInstanceIdLookup(api);
  const root = await lookup(ctx, rule.rootId, rule.rootId);
  if (root.type !== 'FRAME') fail(rule.rootId, root.id, 'Root must be a FRAME');
  const data: PreparedData = {
    api: ctx,
    rule,
    pageId,
    nodes: new Map(),
    variables: new Map(),
    variants: new Map(),
  };
  await Promise.all(
    rule.base.map(async action => {
      const node = await lookup(ctx, rule.rootId, action.nodeId);
      data.nodes.set(node.id, node);
      checkSafe(node, root as FrameNode, pageId);
      if (action.type === 'componentProperties') {
        if (node.type !== 'INSTANCE')
          fail(rule.rootId, node.id, 'Public properties require an INSTANCE');
        const main = await (node as InstanceNode).getMainComponentAsync();
        const variants =
          main?.parent?.type === 'COMPONENT_SET'
            ? main.parent.children.filter((n): n is ComponentNode => n.type === 'COMPONENT')
            : main === null
              ? []
              : [main];
        data.variants.set(node.id, variants);
      }
    }),
  );
  const states = rule.breakpoints.map(b => evaluateResponsiveRoot(rule, b.minWidth));
  const variableTargets = new Map<string, string>();
  for (const desired of states) {
    for (const action of desired.actions)
      for (const [field, value] of Object.entries(action.values)) {
        if (!spacingFields.has(field)) continue;
        const variableId = (value as { variableId?: string }).variableId;
        if (variableId !== undefined) variableTargets.set(variableId, action.nodeId);
      }
  }
  await Promise.all(
    [...variableTargets].map(async ([id, nodeId]) => {
      const variable = await ctx.variables.getVariableByIdAsync(id);
      if (variable === null) fail(rule.rootId, nodeId, `Variable ${id} not found`);
      data.variables.set(id, variable as Variable);
    }),
  );
  for (const desired of states) validateActions(data, root as FrameNode, desired.actions);
  const prepared = Object.freeze({ root: root as FrameNode });
  preparedData.set(prepared, data);
  return prepared;
};

export const applyPreparedResponsiveRoot = (
  prepared: PreparedResponsiveRoot,
  desired: ResponsiveEvaluation,
  isCurrent: () => boolean,
): { status: 'applied' | 'cancelled'; changed: boolean } => {
  const data = preparedData.get(prepared);
  if (data === undefined) throw new Error('Unvalidated responsive root');
  if (!isCurrent()) return { status: 'cancelled', changed: false };
  if (
    JSON.stringify(evaluateResponsiveRoot(data.rule, desired.minWidth)) !== JSON.stringify(desired)
  )
    fail(prepared.root.id, prepared.root.id, 'Unvalidated responsive evaluation');
  validateActions(data, prepared.root, desired.actions);
  let changed = false;
  let currentNodeId = prepared.root.id;
  const write = (setter: () => void): boolean => {
    if (!isCurrent()) return false;
    setter();
    changed = true;
    return true;
  };
  const applyField = (node: SceneNode, field: string, value: unknown): boolean => {
    const target = node as unknown as Record<string, unknown>;
    if (spacingFields.has(field)) {
      const spacing = value as { value: number; variableId?: string };
      if (
        target[field] !== spacing.value &&
        !write(() => {
          target[field] = spacing.value;
        })
      )
        return false;
      const binding = (
        node.boundVariables as Record<string, VariableAlias | undefined> | undefined
      )?.[field];
      if (
        binding?.id !== spacing.variableId &&
        !write(() =>
          node.setBoundVariable(
            field as VariableBindableNodeField,
            spacing.variableId === undefined ? null : data.variables.get(spacing.variableId)!,
          ),
        )
      )
        return false;
      return true;
    }
    return (
      target[field] === value ||
      write(() => {
        target[field] = value;
      })
    );
  };
  const applyTracks = (tracks: GridTrackSize[], desiredTracks: ResponsiveTrack[]): boolean => {
    for (let i = 0; i < desiredTracks.length; i++) {
      const target = tracks[i]!;
      const next = desiredTracks[i]!;
      if (
        target.type !== next.type &&
        !write(() => {
          target.type = next.type;
        })
      )
        return false;
      if (
        next.type !== 'HUG' &&
        target.value !== next.value &&
        !write(() => {
          target.value = next.value;
        })
      )
        return false;
    }
    return true;
  };
  try {
    // GRID tracks and axis sizing have setter dependencies independent of action order.
    for (const action of desired.actions.filter(a => a.type === 'grid')) {
      const node = data.nodes.get(action.nodeId)! as FrameNode;
      currentNodeId = node.id;
      const values = gridOf(node, desired.actions);
      const layout = layoutOf(node, desired.actions);
      const growing = growingGridAxes(node, values);
      for (const field of ['layoutSizingHorizontal', 'layoutSizingVertical'] as const) {
        if (
          node[field] === 'HUG' &&
          growing[field] &&
          !applyField(node, field, layout[field] === 'HUG' ? 'FIXED' : layout[field])
        )
          return { status: 'cancelled', changed };
        if (
          layout[field] !== undefined &&
          layout[field] !== 'HUG' &&
          !applyField(node, field, layout[field])
        )
          return { status: 'cancelled', changed };
      }
      for (const field of ['gridItemsPositioning', 'gridAutoTracks'] as const)
        if (values[field] !== undefined && !applyField(node, field, values[field]))
          return { status: 'cancelled', changed };
      if (values.columns !== undefined) {
        if (
          !applyField(node, 'gridColumnCount', values.columns.length) ||
          !applyTracks(node.gridColumnSizes, values.columns)
        )
          return { status: 'cancelled', changed };
      }
      if (values.rows !== undefined) {
        if (
          !applyField(node, 'gridRowCount', values.rows.length) ||
          !applyTracks(node.gridRowSizes, values.rows)
        )
          return { status: 'cancelled', changed };
      }
      if (
        values.autoRowTrack !== undefined &&
        !applyTracks(
          node.gridRowSizes,
          node.gridRowSizes.map(() => values.autoRowTrack!),
        )
      )
        return { status: 'cancelled', changed };
      for (const field of ['gridRowGap', 'gridColumnGap'] as const)
        if (values[field] !== undefined && !applyField(node, field, values[field]))
          return { status: 'cancelled', changed };
      for (const field of ['layoutSizingHorizontal', 'layoutSizingVertical'] as const)
        if (layout[field] === 'HUG' && !applyField(node, field, 'HUG'))
          return { status: 'cancelled', changed };
    }
    for (const action of desired.actions) {
      const node = data.nodes.get(action.nodeId)!;
      currentNodeId = node.id;
      if (action.type === 'componentProperties') {
        const instance = node as InstanceNode;
        const values = Object.fromEntries(
          Object.entries(action.values).filter(
            ([key, value]) => instance.componentProperties[key]?.value !== value,
          ),
        );
        if (Object.keys(values).length > 0 && !write(() => instance.setProperties(values)))
          return { status: 'cancelled', changed };
      } else if (action.type !== 'grid') {
        for (const [field, value] of Object.entries(action.values)) {
          if (!applyField(node, field, value)) return { status: 'cancelled', changed };
        }
      }
    }
  } catch (error) {
    throw new ResponsiveRootError(
      prepared.root.id,
      'apply',
      error instanceof Error ? error.message : String(error),
      currentNodeId,
    );
  }
  return { status: isCurrent() ? 'applied' : 'cancelled', changed };
};
