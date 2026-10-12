import { z } from 'zod';

const id = z.string().min(1);
const width = z.number().nonnegative();
const nonempty = (values: object): boolean => Object.keys(values).length > 0;
const spacing = (negative = false) =>
  z.strictObject({ value: negative ? z.number() : width, variableId: id.optional() });
const sizing = z.enum(['FIXED', 'HUG', 'FILL']);
const layoutValues = z
  .strictObject({
    layoutMode: z.enum(['HORIZONTAL', 'VERTICAL']).optional(),
    layoutSizingHorizontal: sizing.optional(),
    layoutSizingVertical: sizing.optional(),
    maxWidth: z.number().positive().nullable().optional(),
    paddingTop: spacing().optional(),
    paddingRight: spacing().optional(),
    paddingBottom: spacing().optional(),
    paddingLeft: spacing().optional(),
    itemSpacing: spacing(true).optional(),
    primaryAxisAlignItems: z
      .enum(['MIN', 'CENTER', 'MAX', 'SPACE_BETWEEN', 'SPACE_EVENLY', 'SPACE_AROUND'])
      .optional(),
    counterAxisAlignItems: z.enum(['MIN', 'CENTER', 'MAX', 'BASELINE']).optional(),
    layoutWrap: z.enum(['NO_WRAP', 'WRAP']).optional(),
    counterAxisSpacing: spacing().optional(),
    counterAxisAlignContent: z.enum(['AUTO', 'SPACE_BETWEEN']).optional(),
  })
  .refine(nonempty, 'An action must own at least one field');
const track = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('FIXED'), value: width }),
  z.strictObject({ type: z.literal('FLEX'), value: z.number().positive() }),
  z.strictObject({ type: z.literal('HUG') }),
]);
const gridValues = z.strictObject({
  columns: z.array(track).min(1).max(24).optional(),
  rows: z.array(track).min(1).max(256).optional(),
  autoRowTrack: track.optional(),
  gridItemsPositioning: z.enum(['MANUAL', 'ROW_AUTO_FLOW']).optional(),
  gridAutoTracks: z.enum(['NONE', 'ROWS']).optional(),
  gridRowGap: spacing().optional(),
  gridColumnGap: spacing().optional(),
});
const actionMembers = [
  z.strictObject({ type: z.literal('layout'), nodeId: id, values: layoutValues }),
  z.strictObject({
    type: z.literal('visibility'),
    nodeId: id,
    values: z.strictObject({ visible: z.boolean() }),
  }),
  z.strictObject({
    type: z.literal('componentProperties'),
    nodeId: id,
    values: z
      .record(id, z.union([z.boolean(), z.string()]))
      .refine(nonempty, 'An action must own at least one property'),
  }),
] as const;
const action = z.discriminatedUnion('type', [
  ...actionMembers,
  z.strictObject({
    type: z.literal('grid'),
    nodeId: id,
    values: gridValues.refine(nonempty, 'An action must own at least one field'),
  }),
]);
const override = z.discriminatedUnion('type', [
  ...actionMembers,
  z.strictObject({
    type: z.literal('grid'),
    nodeId: id,
    values: gridValues
      .omit({ gridItemsPositioning: true, gridAutoTracks: true })
      .refine(nonempty, 'An override must own at least one field'),
  }),
]);
const namedValues = z
  .record(id, width)
  .refine(v => Object.keys(v).length <= 24, 'At most 24 breakpoint names');
const selectors = { overrides: z.array(override).max(128) };
const breakpoint = z.union([
  z.strictObject({ at: id, ...selectors }),
  z.strictObject({ minWidth: width, ...selectors }),
]);

/** Thresholds only: no implicit layout, visibility, component semantics or activation. */
const STANDARD_BREAKPOINTS: Readonly<Record<string, number>> = Object.freeze({
  base: 0,
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
});

export const ResponsiveLayoutConfigSchema = z.strictObject({
  version: z.literal(1),
  pageId: id,
  breakpointPreset: z.enum(['standard', 'none']).optional(),
  breakpointValues: namedValues.optional(),
  roots: z
    .array(
      z.strictObject({
        rootId: id,
        base: z.array(action).max(128),
        breakpoints: z.array(breakpoint).min(1).max(24),
        breakpointValues: namedValues.optional(),
      }),
    )
    .min(1)
    .max(32),
});
export const ResponsiveLayoutConfigureInputSchema = z.strictObject({
  enabled: z.boolean(),
  config: ResponsiveLayoutConfigSchema.optional(),
});
export type ResponsiveLayoutConfig = z.infer<typeof ResponsiveLayoutConfigSchema>;
export type ResponsiveLayoutConfigureInput = z.infer<typeof ResponsiveLayoutConfigureInputSchema>;
export type ResponsiveRoot = ResponsiveLayoutConfig['roots'][number];
export type ResponsiveAction = z.infer<typeof action>;
export type ResponsiveLayoutValues = Extract<ResponsiveAction, { type: 'layout' }>['values'];
export type ResponsiveGridValues = Extract<ResponsiveAction, { type: 'grid' }>['values'];
export type ResponsiveTrack = z.infer<typeof track>;
export interface ResolvedResponsiveBreakpoint {
  minWidth: number;
  at?: string | undefined;
  source: 'preset' | 'config' | 'root' | 'numeric';
  overrides: ResponsiveAction[];
}
export interface ResolvedResponsiveRoot {
  rootId: string;
  base: ResponsiveAction[];
  breakpoints: ResolvedResponsiveBreakpoint[];
}
export interface ResolvedResponsiveLayoutConfig {
  config: ResponsiveLayoutConfig;
  breakpointPreset: 'standard' | 'none';
  roots: ResolvedResponsiveRoot[];
}
export interface ResponsiveEvaluation {
  minWidth: number;
  at?: string;
  actions: ResponsiveAction[];
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const actionKey = (a: ResponsiveAction): string => JSON.stringify([a.type, a.nodeId]);
const assertUniqueActions = (actions: ResponsiveAction[]): void => {
  if (new Set(actions.map(actionKey)).size !== actions.length)
    throw new Error('Duplicate responsive action');
};

export const resolveResponsiveLayoutConfig = (
  input: ResponsiveLayoutConfig,
): ResolvedResponsiveLayoutConfig => {
  const config = clone(ResponsiveLayoutConfigSchema.parse(input));
  const breakpointPreset = config.breakpointPreset ?? 'standard';
  const rootIds = new Set<string>();
  const owners = new Map<string, string>();
  const roots = config.roots.map(root => {
    if (rootIds.has(root.rootId)) throw new Error('Duplicate responsive root');
    rootIds.add(root.rootId);
    assertUniqueActions(root.base);
    const owned = new Map(root.base.map(a => [actionKey(a), a]));
    for (const a of root.base) {
      const previous = owners.get(a.nodeId);
      if (previous !== undefined && previous !== root.rootId)
        throw new Error(`Shared responsive target ${a.nodeId}`);
      owners.set(a.nodeId, root.rootId);
    }
    const names = new Map<string, { value: number; source: 'preset' | 'config' | 'root' }>();
    const mergeNames = (
      values: Record<string, number>,
      source: 'preset' | 'config' | 'root',
    ): void => {
      for (const [name, value] of Object.entries(values)) {
        if (name === 'base' && value !== 0) throw new Error('base must be 0');
        names.set(name, { value, source });
      }
    };
    if (breakpointPreset === 'standard') mergeNames(STANDARD_BREAKPOINTS, 'preset');
    mergeNames(config.breakpointValues ?? {}, 'config');
    mergeNames(root.breakpointValues ?? {}, 'root');
    if (names.size > 24) throw new Error('At most 24 effective breakpoint names');
    let previous = -1;
    const breakpoints = root.breakpoints.map((b, index): ResolvedResponsiveBreakpoint => {
      const named = 'at' in b ? names.get(b.at) : undefined;
      if ('at' in b && named === undefined) throw new Error(`Unknown breakpoint ${b.at}`);
      const minWidth = 'minWidth' in b ? b.minWidth : named!.value;
      if ((index === 0 && minWidth !== 0) || minWidth <= previous)
        throw new Error('Breakpoints must start at 0 and increase strictly');
      previous = minWidth;
      assertUniqueActions(b.overrides);
      for (const a of b.overrides) {
        const base = owned.get(actionKey(a));
        if (
          base === undefined ||
          Object.keys(a.values).some(field => !Object.hasOwn(base.values, field))
        )
          throw new Error(`Override exceeds base ownership for ${a.nodeId}`);
      }
      return {
        minWidth,
        ...('at' in b ? { at: b.at } : {}),
        source: named?.source ?? 'numeric',
        overrides: b.overrides,
      };
    });
    return { rootId: root.rootId, base: root.base, breakpoints };
  });
  return { config, breakpointPreset, roots };
};

export const evaluateResponsiveRoot = (
  root: ResolvedResponsiveRoot,
  widthValue: number,
): ResponsiveEvaluation => {
  if (!Number.isFinite(widthValue) || widthValue < 0)
    throw new Error('Responsive width must be finite and nonnegative');
  let selected = root.breakpoints[0]!;
  for (const b of root.breakpoints) {
    if (b.minWidth > widthValue) break;
    selected = b;
  }
  const changes = new Map(selected.overrides.map(a => [actionKey(a), a]));
  const actions = root.base.map(a => {
    const change = changes.get(actionKey(a));
    return clone(
      change === undefined ? a : { ...a, values: { ...a.values, ...change.values } },
    ) as ResponsiveAction;
  });
  return {
    minWidth: selected.minWidth,
    ...(selected.at === undefined ? {} : { at: selected.at }),
    actions,
  };
};

const resolvedBreakpointSchema = z.strictObject({
  minWidth: width,
  at: id.optional(),
  source: z.enum(['preset', 'config', 'root', 'numeric']),
  overrides: z.array(action).max(128),
});
export const SavedResponsiveLayoutSchema = z
  .strictObject({
    version: z.literal(1),
    enabled: z.boolean(),
    inheritedRootIds: z.array(id).max(32).optional(),
    resolved: z.strictObject({
      config: ResponsiveLayoutConfigSchema,
      breakpointPreset: z.enum(['standard', 'none']),
      roots: z
        .array(
          z.strictObject({
            rootId: id,
            base: z.array(action).max(128),
            breakpoints: z.array(resolvedBreakpointSchema).min(1).max(24),
          }),
        )
        .min(1)
        .max(32),
    }),
  })
  .superRefine((saved, ctx) => {
    if (
      saved.inheritedRootIds?.some(
        rootId => !saved.resolved.roots.some(root => root.rootId === rootId),
      ) ||
      new Set(saved.inheritedRootIds).size !== (saved.inheritedRootIds?.length ?? 0)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Inherited root identities must be unique configured roots',
      });
    try {
      // Validate consistency with the immutable preset; retain the saved resolved values.
      if (
        JSON.stringify(resolveResponsiveLayoutConfig(saved.resolved.config)) !==
        JSON.stringify(saved.resolved)
      )
        ctx.addIssue({
          code: 'custom',
          message: 'Saved responsive thresholds or actions are inconsistent',
        });
    } catch (error) {
      ctx.addIssue({
        code: 'custom',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
export interface ResponsiveRootState {
  rootId: string;
  status: 'disabled' | 'paused' | 'active' | 'error';
  width?: number;
  minWidth?: number;
  at?: string;
  lastAppliedAt?: number;
  error?: { nodeId?: string; phase: 'resolve' | 'validate' | 'apply'; message: string };
}
export interface ResponsiveLayoutStatus {
  enabled: boolean;
  config: ResponsiveLayoutConfig | null;
  version: 1 | null;
  breakpointPreset: 'standard' | 'none' | null;
  effectiveBreakpoints: {
    rootId: string;
    breakpoints: Omit<ResolvedResponsiveBreakpoint, 'overrides'>[];
  }[];
  roots: ResponsiveRootState[];
  error?: { phase: 'load'; message: string };
  copyErrors?: { rootId: string; message: string }[];
}
export type ResponsiveLayoutConfigureResult = ResponsiveLayoutStatus & {
  accepted: true;
  applied: boolean;
};
