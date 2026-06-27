import {
  computeMetrics,
  dedupeStyles,
  type DesignContextNode,
  DETAIL_LEVELS,
  type DetailLevel,
  type GetDesignContextResult,
  MIXED,
  type ResolvedToken,
  simplifyPaint,
} from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { serializeFlatSync } from '../serializer.js';

const isSceneNode = (node: BaseNode): node is SceneNode =>
  node.type !== 'DOCUMENT' && node.type !== 'PAGE';

const isDetailLevel = (value: unknown): value is DetailLevel =>
  typeof value === 'string' && (DETAIL_LEVELS as readonly string[]).includes(value);

/**
 * Project a node down to the fields a given detail level exposes. Detail-gated on purpose:
 * get_design_context is the hot read path and defaults to `compact`, so minimal/compact read their
 * few values straight off the node and skip the full serializeFlatSync — which maps every
 * paint/effect and calls getStyledTextSegments on mixed TEXT, work that compact/minimal then
 * discard. serializeNode is a pure passthrough for id/name/type/visible/x/y/w/h and
 * enrichWithMixins never touches those, so the direct reads match projecting the serialized form.
 * The full branch is one serializeFlatSync, every field from flat — so no detail level does more
 * work than it used to. Across all branches, no-op defaults (visible=true / rotation=0 / opacity=1)
 * are omitted.
 */
const project = (node: SceneNode, detail: DetailLevel): DesignContextNode => {
  if (detail === 'minimal') return { id: node.id, name: node.name, type: node.type };
  if (detail === 'compact') {
    const out: DesignContextNode = {
      id: node.id,
      name: node.name,
      type: node.type,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
    };
    // Omit the no-op default (visible defaults to true); only a hidden node is worth a field.
    if (node.visible === false) out.visible = false;
    return out;
  }

  // full — unchanged from the original projection: serializeFlatSync once, every field from flat.
  const flat = serializeFlatSync(node);
  const out: DesignContextNode = { id: flat.id, name: flat.name, type: flat.type };
  // No-op defaults are omitted (consistent with every other field here): absent visible = true,
  // absent rotation = 0, absent opacity = 1, absent cornerRadius = 0 (unrounded). Strict equality so
  // a 0.0001-rad rotation or a 0.99 opacity still surfaces; `mixed` corners (the MIXED symbol) are
  // never 0 so they stay. The generated code is identical; the payload is just smaller. cornerRadius=0
  // is the highest-volume of these — it sits on every frame/shape — so omitting it matters most.
  if (flat.visible === false) out.visible = false;
  out.x = flat.x;
  out.y = flat.y;
  out.width = flat.width;
  out.height = flat.height;

  if (flat.rotation !== undefined && flat.rotation !== 0) out.rotation = flat.rotation;
  if (flat.opacity !== undefined && flat.opacity !== 1) out.opacity = flat.opacity;
  if (flat.cornerRadius !== undefined && flat.cornerRadius !== 0)
    out.cornerRadius = flat.cornerRadius;
  if (flat.cornerRadii !== undefined) out.cornerRadii = flat.cornerRadii;
  if (flat.blendMode !== undefined) out.blendMode = flat.blendMode;
  if (flat.isMask !== undefined) out.isMask = flat.isMask;
  if (flat.maskType !== undefined) out.maskType = flat.maskType;
  if (flat.arcData !== undefined) out.arcData = flat.arcData;
  if (flat.fills !== undefined) out.fills = flat.fills;
  if (flat.strokes !== undefined) out.strokes = flat.strokes;
  if (flat.strokeWeight !== undefined) out.strokeWeight = flat.strokeWeight;
  if (flat.strokeWeights !== undefined) out.strokeWeights = flat.strokeWeights;
  if (flat.strokeAlign !== undefined) out.strokeAlign = flat.strokeAlign;
  if (flat.effects !== undefined) out.effects = flat.effects;
  // Auto-layout / positioning — surfaced here (not just get_node) so codegen reads exact padding /
  // gap / justify / align / grid placement instead of inferring them from x/y/w/h geometry.
  if (flat.layout !== undefined) out.layout = flat.layout;
  if (flat.layoutSizingHorizontal !== undefined) {
    out.layoutSizingHorizontal = flat.layoutSizingHorizontal;
  }
  if (flat.layoutSizingVertical !== undefined) out.layoutSizingVertical = flat.layoutSizingVertical;
  if (flat.layoutGrow !== undefined) out.layoutGrow = flat.layoutGrow;
  if (flat.layoutAlign !== undefined) out.layoutAlign = flat.layoutAlign;
  if (flat.layoutPositioning !== undefined) out.layoutPositioning = flat.layoutPositioning;
  if (flat.gridChild !== undefined) out.gridChild = flat.gridChild;
  if (flat.constraints !== undefined) out.constraints = flat.constraints;
  if (flat.clipsContent !== undefined) out.clipsContent = flat.clipsContent;
  if (flat.characters !== undefined) out.characters = flat.characters;
  if (flat.fontSize !== undefined) out.fontSize = flat.fontSize;
  if (flat.fontName !== undefined) out.fontName = flat.fontName;
  // Typography the serializer already computes but get_design_context used to drop — without these
  // codegen eyeballs casing / leading / tracking / underlines / alignment / clamping off the raster.
  // Surfaced only when it differs from the no-op default, so a plain left-aligned body paragraph
  // stays clean and only the meaningful values show (a centered UPPERCASE tracked heading, an
  // underlined link, a 2-line clamp). `mixed` (per-segment styling) is always meaningful → kept.
  // Style-level ones (lineHeight/letterSpacing/textCase/textDecoration) fold into the textStyle
  // bundle in dedupeStyles; align/truncation stay inline (they vary per instance, not per style).
  const lh = flat.lineHeight;
  if (lh !== undefined && (lh === MIXED || lh.unit !== 'AUTO')) out.lineHeight = lh;
  const ls = flat.letterSpacing;
  if (ls !== undefined && (ls === MIXED || ls.value !== 0)) out.letterSpacing = ls;
  if (flat.textCase !== undefined && flat.textCase !== 'ORIGINAL') out.textCase = flat.textCase;
  if (flat.textDecoration !== undefined && flat.textDecoration !== 'NONE') {
    out.textDecoration = flat.textDecoration;
  }
  if (flat.textAlignHorizontal !== undefined && flat.textAlignHorizontal !== 'LEFT') {
    out.textAlignHorizontal = flat.textAlignHorizontal;
  }
  if (flat.textAlignVertical !== undefined && flat.textAlignVertical !== 'TOP') {
    out.textAlignVertical = flat.textAlignVertical;
  }
  if (flat.textTruncation !== undefined && flat.textTruncation !== 'DISABLED') {
    out.textTruncation = flat.textTruncation;
  }
  if (typeof flat.maxLines === 'number') out.maxLines = flat.maxLines;
  // Per-run styling of a mixed TEXT node — serializeFlatSync already computed this (only set when the
  // node is genuinely mixed), get_design_context just used to drop it. Carry it so inline bold / links
  // / coloured spans survive instead of collapsing to a single `mixed` marker. fills are simplified to
  // hex like every other paint in this view.
  if (flat.segments !== undefined) {
    out.segments = flat.segments.map(s => ({
      characters: s.characters,
      start: s.start,
      end: s.end,
      fontName: s.fontName,
      fontSize: s.fontSize,
      fills: s.fills.map(simplifyPaint),
      textDecoration: s.textDecoration,
      textCase: s.textCase,
    }));
  }
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

/** Width buckets mirror responsive.md: ~≥1280 desktop · 600–1280 tablet · <600 mobile. */
const widthBucket = (w: number): string => (w >= 1280 ? 'desktop' : w >= 600 ? 'tablet' : 'mobile');

/**
 * When the selection holds several top-level FRAMEs whose widths fall in _different_ buckets it's a
 * breakpoint set — the exact shape that tempts a caller to size one breakpoint by eye off another
 * (the failure mode behind "mixed desktop+mobile codegen is inaccurate"). Return the don't-merge
 * rule so even a caller that skipped the figma-codegen skill (or used the grounding-free `compact`
 * default) still gets it. Same-bucket siblings get nothing — two 375 frames are a screen + its menu
 * state, two desktop frames are two screens; neither is a breakpoint diff to ground separately.
 *
 * Screen-count aware: more frames than buckets means at least one bucket holds >1 frame, i.e.
 * several screens each with their own breakpoints are selected (A-desktop/A-mobile + B-desktop/
 * B-mobile). Then the extra risk is mis-pairing across screens, so the hint leads with the pairing
 * rule before the per-frame grounding rule.
 */
const breakpointHint = (roots: readonly SceneNode[]): string | undefined => {
  const frames = roots.filter((r): r is FrameNode => r.type === 'FRAME');
  if (frames.length < 2) return undefined;
  const buckets = new Set(frames.map(f => widthBucket(f.width)));
  if (buckets.size < 2) return undefined;

  // Distinct widths, widest first — avoids "1440 / 375 / 1440 / 375" when several screens share buckets.
  const widths = [...new Set(frames.map(f => Math.round(f.width)))]
    .toSorted((a, b) => b - a)
    .join(' / ');
  const multipleScreens = frames.length > buckets.size;
  const acrossScreens = multipleScreens ? ' or screens' : '';
  const action =
    `get_design_context on EACH frame by its own nodeId and take every size (font, line-height, ` +
    `padding, gap) from that frame's own data — never carry sizes across breakpoints${acrossScreens}, ` +
    `never pick one as canonical and scale the others by eye, and never read sizes off the screenshot ` +
    `raster. The output stays responsive: emit these as mobile-first breakpoint variants (e.g. ` +
    `px-4 lg:px-20), keep the container fluid (w-full / max-w), and never hardcode a frame's own ` +
    `width — no w-[375px] root and no fixed-width mobile menu (a full-bleed menu is fixed inset-0 w-full).`;
  const lead =
    `Selection holds ${frames.length} top-level frames spanning widths ${widths}px — these are ` +
    `breakpoints, not one combined screen. `;
  return multipleScreens
    ? lead +
        `More than one screen is present: first pair each screen to its own breakpoint frames (by ` +
        `normalized name / matching content), then run ${action}`
    : lead + `Run ${action}`;
};

interface BuildCtx {
  detail: DetailLevel;
  dedupe: boolean;
  seen: Set<string>;
}

/**
 * The visible text a deduped instance actually renders — every visible TEXT descendant's
 * `characters` in DFS order. Text-only on purpose: the structure/style subtree stays collapsed
 * (that's the dedup win), but per-instance content (card titles, list items, form labels) survives
 * so codegen needn't re-expand the tree. Hidden nodes are skipped (whole subtree) since they don't
 * render; empty strings are dropped as noise.
 */
const collectTextOverrides = (instance: SceneNode): { name: string; characters: string }[] => {
  const out: { name: string; characters: string }[] = [];
  const visit = (n: SceneNode): void => {
    if (n.visible === false) return;
    if (n.type === 'TEXT') {
      const chars = (n as TextNode).characters;
      if (chars !== '') out.push({ name: n.name, characters: chars });
      return;
    }
    if ('children' in n) {
      for (const c of (n as SceneNode & { children: readonly SceneNode[] }).children) visit(c);
    }
  };
  if ('children' in instance) {
    for (const c of (instance as SceneNode & { children: readonly SceneNode[] }).children) visit(c);
  }
  return out;
};

/** RemainingDepth: -1 = unlimited; otherwise levels of children still allowed below this node. */
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
        const mc: NonNullable<DesignContextNode['mainComponent']> = {
          id: main.id,
          name: main.name,
          key: main.key,
        };
        // A variant component's parent is the COMPONENT_SET. Carry its identity so component_map can
        // group/name by the set ("Button") instead of the variant signature ("Size=…, State=…") —
        // resolving it here (the parent is already loaded) avoids a doc-wide get_local_components scan.
        const parent = main.parent;
        if (parent != null && parent.type === 'COMPONENT_SET') {
          mc.componentSetId = parent.id;
          mc.componentSetName = parent.name;
        }
        out.mainComponent = mc;
      }
      if (ctx.dedupe) {
        if (ctx.seen.has(main.id)) {
          out.deduped = true;
          expandChildren = false;
          const overrides = collectTextOverrides(node);
          if (overrides.length > 0) out.textOverrides = overrides;
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
      // No nodeId and nothing selected: refuse rather than fall back to the whole page. A bare
      // currentPage.children scan times out on large pages, and the selection is also the signal
      // that tells the user which frame they actually want generated. Ask for one explicitly.
      throw new Error(
        'Nothing selected. Select one or more frames/layers in Figma (or pass an explicit nodeId). ' +
          'get_design_context no longer scans the whole page — it is too large and ambiguous.',
      );
    }

    const nodes = await Promise.all(roots.map(root => buildNode(root, remainingDepth, ctx)));
    const result: GetDesignContextResult = { nodes };

    // Multi-breakpoint selection → attach the ground-each-frame rule (any detail level; the
    // grounding-free `compact` default is exactly where this is most needed).
    const hint = breakpointHint(roots);
    if (hint !== undefined) result.hint = hint;

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
