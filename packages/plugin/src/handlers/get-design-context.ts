import {
  type DesignContextNode,
  DETAIL_LEVELS,
  type DetailLevel,
  type GetDesignContextResult,
} from '@figma-mcp-relay/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { serializeFlatSync } from '../serializer.js';

const isSceneNode = (node: BaseNode): node is SceneNode =>
  node.type !== 'DOCUMENT' && node.type !== 'PAGE';

const isDetailLevel = (value: unknown): value is DetailLevel =>
  typeof value === 'string' && (DETAIL_LEVELS as readonly string[]).includes(value);

/** Project a fully-serialized node down to the fields a given detail level exposes. */
const project = (node: SceneNode, detail: DetailLevel): DesignContextNode => {
  const flat = serializeFlatSync(node);
  const out: DesignContextNode = { id: flat.id, name: flat.name, type: flat.type };
  if (detail === 'minimal') return out;

  out.visible = flat.visible;
  out.x = flat.x;
  out.y = flat.y;
  out.width = flat.width;
  out.height = flat.height;
  if (detail === 'compact') return out;

  if (flat.rotation !== undefined) out.rotation = flat.rotation;
  if (flat.opacity !== undefined) out.opacity = flat.opacity;
  if (flat.cornerRadius !== undefined) out.cornerRadius = flat.cornerRadius;
  if (flat.fills !== undefined) out.fills = flat.fills;
  if (flat.characters !== undefined) out.characters = flat.characters;
  if (flat.fontSize !== undefined) out.fontSize = flat.fontSize;
  if (flat.fontName !== undefined) out.fontName = flat.fontName;
  // Grounding fields (M3 P1): surface what serializeFlatSync already captured but
  // get_design_context used to drop. id→token-name resolution + globalVars dedup land in P2/P3.
  if (flat.styleIds !== undefined) out.styleIds = flat.styleIds;
  if (flat.boundVariables !== undefined) out.boundVariables = flat.boundVariables;
  if (flat.componentProperties !== undefined) out.componentProperties = flat.componentProperties;
  return out;
};

interface BuildCtx {
  detail: DetailLevel;
  dedupe: boolean;
  seen: Set<string>;
}

/** remainingDepth: -1 = unlimited; otherwise levels of children still allowed below this node. */
const buildNode = async (
  node: SceneNode,
  remainingDepth: number,
  ctx: BuildCtx,
): Promise<DesignContextNode> => {
  const out = project(node, ctx.detail);

  let expandChildren = true;
  // Resolve the main component when deduping (needs the id) or at full detail (needs name/key for
  // component_map). componentProperties on the instance itself are surfaced in project() and survive
  // dedup — only the expanded child subtree below is collapsed.
  if (node.type === 'INSTANCE' && (ctx.dedupe || ctx.detail === 'full')) {
    const main = await (node as InstanceNode).getMainComponentAsync();
    if (main !== null) {
      out.mainComponentId = main.id;
      if (ctx.detail === 'full') {
        out.mainComponent = { id: main.id, name: main.name, key: main.key };
      }
      if (ctx.dedupe) {
        if (ctx.seen.has(main.id)) {
          out.deduped = true;
          expandChildren = false;
        } else {
          ctx.seen.add(main.id);
        }
      }
    }
  }

  if (expandChildren && 'children' in node) {
    const children = (node as SceneNode & { children: readonly SceneNode[] }).children;
    if (children.length > 0) {
      if (remainingDepth === 0) {
        out.truncated = true;
      } else {
        const next = remainingDepth < 0 ? -1 : remainingDepth - 1;
        out.children = await Promise.all(children.map(child => buildNode(child, next, ctx)));
      }
    }
  }

  return out;
};

export const createGetDesignContextHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as {
      nodeId?: unknown;
      depth?: unknown;
      detail?: unknown;
      dedupeComponents?: unknown;
    };

    if (p.nodeId !== undefined && typeof p.nodeId !== 'string') {
      throw new TypeError('get_design_context: nodeId must be a string');
    }
    if (p.depth !== undefined && (typeof p.depth !== 'number' || p.depth < 0)) {
      throw new TypeError('get_design_context: depth must be a non-negative number');
    }
    if (p.detail !== undefined && !isDetailLevel(p.detail)) {
      throw new TypeError(`get_design_context: detail must be one of ${DETAIL_LEVELS.join(' / ')}`);
    }
    if (p.dedupeComponents !== undefined && typeof p.dedupeComponents !== 'boolean') {
      throw new TypeError('get_design_context: dedupeComponents must be a boolean');
    }

    // depth omitted or 0 → unlimited (-1); positive → that many levels of children.
    const remainingDepth = typeof p.depth === 'number' && p.depth > 0 ? p.depth : -1;
    const ctx: BuildCtx = {
      detail: isDetailLevel(p.detail) ? p.detail : 'compact',
      dedupe: p.dedupeComponents === true,
      seen: new Set<string>(),
    };

    let roots: readonly SceneNode[];
    if (typeof p.nodeId === 'string') {
      const node = await figmaCtx.getNodeByIdAsync(p.nodeId);
      roots = node !== null && isSceneNode(node) ? [node] : [];
    } else if (figmaCtx.currentPage.selection.length > 0) {
      roots = figmaCtx.currentPage.selection;
    } else {
      roots = figmaCtx.currentPage.children;
    }

    const nodes = await Promise.all(roots.map(root => buildNode(root, remainingDepth, ctx)));
    const result: GetDesignContextResult = { nodes };
    return result;
  };
