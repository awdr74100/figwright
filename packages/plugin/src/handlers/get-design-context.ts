import {
  computeMetrics,
  dedupeStyles,
  type DesignContextNode,
  DETAIL_LEVELS,
  type DetailLevel,
  type GetDesignContextResult,
  type ResolvedToken,
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
  if (flat.strokes !== undefined) out.strokes = flat.strokes;
  if (flat.strokeWeight !== undefined) out.strokeWeight = flat.strokeWeight;
  if (flat.strokeAlign !== undefined) out.strokeAlign = flat.strokeAlign;
  if (flat.effects !== undefined) out.effects = flat.effects;
  if (flat.characters !== undefined) out.characters = flat.characters;
  if (flat.fontSize !== undefined) out.fontSize = flat.fontSize;
  if (flat.fontName !== undefined) out.fontName = flat.fontName;
  // Grounding fields (M3 P1): surface what serializeFlatSync already captured but
  // get_design_context used to drop. id→token-name resolution lands in P2 (top-level maps below);
  // globalVars dedup in P3.
  if (flat.styleIds !== undefined) {
    // Figma's *StyleId values carry a trailing comma artifact (e.g. "S:abc,"); strip it so the id
    // matches the `styles` resolution map key and joins cleanly downstream.
    const ids = flat.styleIds as Record<string, string>;
    const cleaned: Record<string, string> = {};
    for (const [k, raw] of Object.entries(ids)) cleaned[k] = raw.replace(/,+$/, '');
    out.styleIds = cleaned;
  }
  if (flat.boundVariables !== undefined) out.boundVariables = flat.boundVariables;
  if (flat.componentProperties !== undefined) out.componentProperties = flat.componentProperties;
  return out;
};

/** Gather every variable id (boundVariables) and shared-style id (styleIds) referenced in a tree. */
const collectRefs = (
  nodes: readonly DesignContextNode[],
): { varIds: Set<string>; styleIds: Set<string> } => {
  const varIds = new Set<string>();
  const styleIds = new Set<string>();
  const visit = (n: DesignContextNode): void => {
    if (n.boundVariables) {
      for (const ids of Object.values(n.boundVariables)) for (const id of ids) varIds.add(id);
    }
    if (n.styleIds) {
      for (const id of Object.values(n.styleIds as Record<string, string>)) {
        if (id !== '') styleIds.add(id);
      }
    }
    if (n.children) for (const c of n.children) visit(c);
  };
  for (const n of nodes) visit(n);
  return { varIds, styleIds };
};

/**
 * Resolve referenced variable + style ids to names (deduped, top-level). Handles both local and
 * library/published refs via the per-id async lookups. Unresolvable refs (e.g. a library variable
 * not subscribed in this file) are silently skipped — the node's inline value stays the fallback.
 */
const resolveTokens = async (
  figmaCtx: typeof figma,
  nodes: readonly DesignContextNode[],
): Promise<Pick<GetDesignContextResult, 'variables' | 'styles'>> => {
  const { varIds, styleIds } = collectRefs(nodes);
  const out: Pick<GetDesignContextResult, 'variables' | 'styles'> = {};

  const getVar = figmaCtx.variables?.getVariableByIdAsync;
  if (varIds.size > 0 && typeof getVar === 'function') {
    const variables: Record<string, ResolvedToken> = {};
    await Promise.all(
      [...varIds].map(async id => {
        try {
          const v = await getVar.call(figmaCtx.variables, id);
          if (v !== null) variables[id] = { name: v.name, type: v.resolvedType };
        } catch {
          /* unresolved ref — skip, inline value remains the fallback */
        }
      }),
    );
    if (Object.keys(variables).length > 0) out.variables = variables;
  }

  const getStyle = figmaCtx.getStyleByIdAsync;
  if (styleIds.size > 0 && typeof getStyle === 'function') {
    const styles: Record<string, ResolvedToken> = {};
    await Promise.all(
      [...styleIds].map(async id => {
        try {
          const s = await getStyle.call(figmaCtx, id);
          if (s !== null) styles[id] = { name: s.name, type: s.type };
        } catch {
          /* unresolved ref — skip */
        }
      }),
    );
    if (Object.keys(styles).length > 0) out.styles = styles;
  }

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

    // Full detail only: resolve token ids → names (P2), then dedupe styles into globalVars and
    // measure the simplification (P3). Below full, styleIds/boundVariables/fills aren't surfaced.
    if (ctx.detail === 'full') {
      Object.assign(result, await resolveTokens(figmaCtx, nodes));
      const { nodes: deduped, globalVars } = dedupeStyles(nodes);
      result.nodes = deduped;
      if (Object.keys(globalVars.styles).length > 0) result.globalVars = globalVars;
      result.metrics = computeMetrics(nodes, result);
    }
    return result;
  };
