import {
  ResponsiveLayoutConfigSchema,
  type ResponsiveLayoutConfig,
  type ResponsiveRoot,
} from '@figwright/shared';
import { z } from 'zod';

import { withInstanceIdLookup } from './node-lookup.js';

const KEY = 'responsive_layout_root';
const TemplateSchema = z.strictObject({
  version: z.literal(1),
  fileName: z.string(),
  pageId: z.string(),
  root: ResponsiveLayoutConfigSchema.shape.roots.element,
  paths: z.record(
    z.string(),
    z.array(
      z.strictObject({
        index: z.number().int().nonnegative(),
        type: z.string(),
        name: z.string(),
      }),
    ),
  ),
});
const targets = (root: ResponsiveRoot): string[] => [
  ...new Set([root.rootId, ...root.base.map(action => action.nodeId)]),
];
const isOnPage = (node: BaseNode, pageId: string): boolean => {
  for (let parent = node.parent; parent !== null; parent = parent.parent) {
    if (
      parent.type === 'INSTANCE' ||
      parent.type === 'COMPONENT' ||
      parent.type === 'COMPONENT_SET'
    )
      return false;
    if (parent.type === 'PAGE') return parent.id === pageId;
  }
  return false;
};

/** Only metadata copied from a currently owned root can grant another frame the same rules. */
export const createResponsiveCopyTracker = (api: typeof figma) => {
  const ctx = withInstanceIdLookup(api);
  const pending = new Set<FrameNode>();
  const errors = new Map<string, string>();
  const reset = (): void => {
    pending.clear();
    errors.clear();
  };
  const visit = (node: BaseNode): void => {
    if (
      node.removed ||
      node.type === 'INSTANCE' ||
      node.type === 'COMPONENT' ||
      node.type === 'COMPONENT_SET'
    )
      return;
    if (node.type === 'FRAME' && node.getPluginData(KEY) !== '') pending.add(node);
    if ('children' in node) for (const child of node.children) visit(child);
  };
  const collect = (event?: NodeChangeEvent): void => {
    if (event === undefined) for (const child of ctx.currentPage.children) visit(child);
    else
      for (const change of event.nodeChanges) {
        if (change.type === 'DELETE') {
          errors.delete(change.id);
          continue;
        }
        if (!('parent' in change.node)) continue;
        visit(change.node);
        for (
          let node = change.node.parent;
          node !== null && node.type !== 'PAGE';
          node = node.parent
        )
          if (node.type === 'FRAME' && node.getPluginData(KEY) !== '') pending.add(node);
      }
  };
  const inherit = (config: ResponsiveLayoutConfig): ResponsiveRoot[] => {
    const added: ResponsiveRoot[] = [];
    for (const candidate of pending) {
      pending.delete(candidate);
      if (
        candidate.removed ||
        config.roots.some(root => root.rootId === candidate.id) ||
        !isOnPage(candidate, config.pageId)
      )
        continue;
      try {
        const template = TemplateSchema.parse(JSON.parse(candidate.getPluginData(KEY)));
        const source = config.roots.find(root => root.rootId === template.root.rootId);
        if (
          template.fileName !== ctx.root.name ||
          template.pageId !== config.pageId ||
          source === undefined ||
          JSON.stringify(source) !== JSON.stringify(template.root)
        ) {
          errors.delete(candidate.id);
          continue;
        }
        if (config.roots.length + added.length >= 32)
          throw new Error(
            'At most 32 responsive roots; remove a root before adopting another copy',
          );
        const ids = new Map<string, string>();
        for (const oldId of targets(template.root)) {
          const path = template.paths[oldId];
          if (path === undefined) throw new Error(`Missing copied target path for ${oldId}`);
          let found: BaseNode = candidate;
          for (const step of path) {
            const next: BaseNode | undefined =
              'children' in found ? found.children[step.index] : undefined;
            if (
              next === undefined ||
              next.type !== step.type ||
              next.name !== step.name ||
              next.removed
            )
              throw new Error(`Copied structure no longer matches target ${oldId}`);
            found = next;
          }
          ids.set(oldId, found.id);
        }
        const mapAction = <T extends { nodeId: string }>(action: T): T => ({
          ...action,
          nodeId: ids.get(action.nodeId)!,
        });
        added.push({
          ...template.root,
          rootId: candidate.id,
          base: template.root.base.map(mapAction),
          breakpoints: template.root.breakpoints.map(b =>
            Object.assign({}, b, {
              overrides: b.overrides.map(mapAction),
            }),
          ),
        });
        errors.delete(candidate.id);
      } catch (error) {
        errors.set(candidate.id, error instanceof Error ? error.message : String(error));
      }
    }
    return added;
  };
  const stamp = async (
    node: FrameNode,
    root: ResponsiveRoot,
    pageId: string,
    current: () => boolean,
  ): Promise<void> => {
    const entries = await Promise.all(
      targets(root).map(async id => {
        let found = await ctx.getNodeByIdAsync(id);
        const path: z.infer<typeof TemplateSchema>['paths'][string] = [];
        while (found !== node) {
          if (found === null || found.parent === null || !('children' in found.parent))
            throw new Error(`Cannot locate copied target ${id}`);
          const index = found.parent.children.indexOf(found as SceneNode);
          if (index < 0) throw new Error(`Cannot locate copied target ${id}`);
          path.unshift({ index, type: found.type, name: found.name });
          found = found.parent;
        }
        return [id, path] as const;
      }),
    );
    if (!current()) return;
    const paths = Object.fromEntries(entries);
    const value = JSON.stringify({ version: 1, fileName: ctx.root.name, pageId, root, paths });
    if (node.getPluginData(KEY) !== value) node.setPluginData(KEY, value);
  };
  return {
    reset,
    collect,
    inherit,
    stamp,
    errors: () => [...errors].map(([rootId, message]) => ({ rootId, message })),
  };
};
