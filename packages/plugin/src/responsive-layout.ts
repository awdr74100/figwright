import {
  evaluateResponsiveRoot,
  resolveResponsiveLayoutConfig,
  ResponsiveLayoutConfigureInputSchema,
  SavedResponsiveLayoutSchema,
} from '@figwright/shared';
import type {
  ResolvedResponsiveLayoutConfig,
  ResponsiveLayoutConfigureResult,
  ResponsiveLayoutStatus,
  ResponsiveRootState,
} from '@figwright/shared';

import {
  applyPreparedResponsiveRoot,
  prepareResponsiveRoot,
  ResponsiveRootError,
  validateResponsiveOwnership,
} from './responsive-layout-adapter.js';

export interface ResponsiveLayoutController {
  configure(params: unknown): Promise<ResponsiveLayoutConfigureResult>;
  get(): ResponsiveLayoutStatus;
  start(): void;
  dispose(): void;
}
const SLOT = 'responsive_layout';
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export const createResponsiveLayoutController = (api: typeof figma): ResponsiveLayoutController => {
  let resolved: ResolvedResponsiveLayoutConfig | null = null;
  let enabled = false;
  let started = false;
  let disposed = false;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let watchedPage: PageNode | null = null;
  let queue = Promise.resolve();
  let roots: ResponsiveRootState[] = [];
  let loadError: ResponsiveLayoutStatus['error'];
  const current = (token: number): boolean =>
    !disposed &&
    enabled &&
    token === generation &&
    resolved !== null &&
    api.currentPage.id === resolved.config.pageId;
  const invalidate = (): number => {
    generation++;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    // A blocked old lookup must not prevent disable/replacement from taking effect.
    queue = Promise.resolve();
    return generation;
  };
  const get = (): ResponsiveLayoutStatus =>
    copy({
      enabled,
      config: resolved?.config ?? null,
      version: resolved === null ? null : 1,
      breakpointPreset: resolved?.breakpointPreset ?? null,
      effectiveBreakpoints:
        resolved?.roots.map(r => ({
          rootId: r.rootId,
          breakpoints: r.breakpoints.map(({ overrides: _overrides, ...b }) => b),
        })) ?? [],
      roots,
      ...(loadError === undefined ? {} : { error: loadError }),
    });
  const apply = async (token: number): Promise<void> => {
    if (!current(token) || resolved === null) return;
    const selected = resolved;
    // Resolve roots in parallel; apply in configured order, with independent error states.
    const prepared = await Promise.all(
      selected.roots.map(async (rule, index) => {
        if (roots[index]?.status === 'error') return null;
        try {
          return {
            index,
            prepared: await prepareResponsiveRoot(api, rule, selected.config.pageId),
          };
        } catch (error) {
          if (current(token)) {
            const e =
              error instanceof ResponsiveRootError
                ? error
                : new ResponsiveRootError(
                    rule.rootId,
                    'resolve',
                    error instanceof Error ? error.message : String(error),
                  );
            roots[index] = {
              rootId: rule.rootId,
              status: 'error',
              error: {
                phase: e.phase,
                message: e.message,
                ...(e.nodeId === undefined ? {} : { nodeId: e.nodeId }),
              },
            };
          }
          return null;
        }
      }),
    );
    if (!current(token)) return;
    for (const result of prepared) {
      if (result === null || !current(token)) continue;
      const { index, prepared: root } = result;
      const rule = selected.roots[index]!;
      try {
        const desired = evaluateResponsiveRoot(rule, root.root.width);
        const applied = applyPreparedResponsiveRoot(root, desired, () => current(token));
        if (applied.status === 'applied' && current(token))
          roots[index] = {
            rootId: rule.rootId,
            status: 'active',
            width: root.root.width,
            minWidth: desired.minWidth,
            ...(desired.at === undefined ? {} : { at: desired.at }),
            lastAppliedAt: Date.now(),
          };
      } catch (error) {
        if (!current(token)) continue;
        const e =
          error instanceof ResponsiveRootError
            ? error
            : new ResponsiveRootError(
                rule.rootId,
                'apply',
                error instanceof Error ? error.message : String(error),
              );
        roots[index] = {
          rootId: rule.rootId,
          status: 'error',
          error: {
            phase: e.phase,
            message: e.message,
            ...(e.nodeId === undefined ? {} : { nodeId: e.nodeId }),
          },
        };
      }
    }
  };
  const enqueue = (token: number): Promise<void> => {
    const work = queue.then(() => apply(token));
    queue = work.catch(() => undefined);
    return work;
  };
  const onChange = (): void => {
    if (!current(generation)) return;
    if (timer !== undefined) clearTimeout(timer);
    const token = generation;
    timer = setTimeout(() => {
      timer = undefined;
      void enqueue(token);
    }, 120);
  };
  const updateWatch = (): void => {
    const shouldWatch = started && current(generation);
    const page = shouldWatch ? api.currentPage : null;
    if (page === watchedPage) return;
    watchedPage?.off('nodechange', onChange);
    watchedPage = page;
    watchedPage?.on('nodechange', onChange);
  };
  const onPage = (): void => {
    const token = invalidate();
    updateWatch();
    for (const root of roots)
      if (root.status !== 'error') root.status = !enabled ? 'disabled' : 'paused';
    if (current(token)) void enqueue(token);
  };
  const configure = async (params: unknown): Promise<ResponsiveLayoutConfigureResult> => {
    if (disposed) throw new Error('Responsive controller is disposed');
    const input = ResponsiveLayoutConfigureInputSchema.parse(params);
    const candidate =
      input.config === undefined ? resolved : resolveResponsiveLayoutConfig(input.config);
    const token = invalidate();
    try {
      if (input.config !== undefined && candidate !== null) {
        if (api.currentPage.id !== candidate.config.pageId)
          throw new Error('New responsive config must target the current page');
        await validateResponsiveOwnership(api, candidate);
      }
      if (token !== generation || disposed)
        throw new Error('Responsive configuration was superseded');
      if (input.enabled && candidate === null)
        throw new Error('Configure responsive rules before enabling');
      // Save only an accepted, explicit configure. No startup migration or event persistence.
      if (candidate !== null)
        api.root.setPluginData(
          SLOT,
          JSON.stringify({ version: 1, enabled: input.enabled, resolved: candidate }),
        );
      resolved = candidate;
      enabled = input.enabled;
      loadError = undefined;
      roots =
        candidate?.roots.map(rule => ({
          rootId: rule.rootId,
          status: enabled ? 'paused' : 'disabled',
        })) ?? [];
      updateWatch();
      if (current(token)) await enqueue(token);
      return {
        accepted: true,
        applied: current(token) && roots.every(root => root.status === 'active'),
        ...get(),
      };
    } catch (error) {
      if (token === generation && !disposed) {
        updateWatch();
        if (current(token)) onChange();
      }
      throw error;
    }
  };
  return {
    configure,
    get,
    start: () => {
      if (started || disposed) return;
      started = true;
      const saved = api.root.getPluginData(SLOT);
      if (saved !== '')
        try {
          const parsed = SavedResponsiveLayoutSchema.parse(JSON.parse(saved));
          resolved = parsed.resolved;
          enabled = parsed.enabled;
          roots = parsed.resolved.roots.map(rule => ({
            rootId: rule.rootId,
            status: enabled ? 'paused' : 'disabled',
          }));
        } catch (error) {
          enabled = false;
          resolved = null;
          loadError = {
            phase: 'load',
            message: error instanceof Error ? error.message : String(error),
          };
        }
      api.on('currentpagechange', onPage);
      updateWatch();
      if (current(generation)) void enqueue(generation);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      enabled = false;
      invalidate();
      updateWatch();
      if (started) api.off('currentpagechange', onPage);
      for (const root of roots) if (root.status !== 'error') root.status = 'disabled';
    },
  };
};
