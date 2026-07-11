import {
  DESIGN_CONTEXT_CHAR_BUDGET,
  type DesignContextNode,
  type DesignContextSection,
  type GetDesignContextResult,
} from '@figwright/shared';
import { z } from 'zod';

import { annotateProjectTokens, loadTokenValueIndex } from '../tokens/token-index.js';
import { getDesignContextTool } from './get-design-context.js';

// The public-path guard around get_design_context, the hot grounding read. Internal consumers
// (design_diff snapshots, component/icon map walks) dispatch the tool directly and are untouched;
// this wrapper only runs for the MCP tool call, where the result lands in an LLM context.
//
// The public call defaults to the CODE-GENERATION view — detail 'full' + dedupeComponents true —
// because the default caller is someone turning a design into code, and a compact default made
// exactly that caller eyeball styling off a screenshot (the classic accuracy failure). Structure
// scans stay one explicit `detail: 'compact'` away. From there the result degrades in a cascade,
// each step only firing where the previous shape could not be delivered:
//
//   full fits the budget                     → full (the accurate default)
//   full over budget, structure fits         → compact projection of the same payload + note
//   structure over budget too / below-full   → section plan (ground per section at full)
//   tree too large to even serialize (bail)  → section plan straight from the plugin, pre-work
//
// The plugin's pre-serialization bail is armed with budget: true (the coarse net); the mcp-side
// char budget is the precise net, anchored to Claude Code's default MCP result cap
// (MAX_MCP_OUTPUT_TOKENS = 25k tokens ≈ 100k chars of minified JSON) — beyond it the result errors
// out today and delivers nothing, so every downgrade replaces a dead end, never a working result.

export type ToolDispatcher = (toolName: string, args: unknown) => Promise<unknown>;

const BELOW_FULL_NOTE =
  'Styling, layout, text and design-token fields are omitted below detail "full". For code ' +
  'generation call again with detail: "full" and dedupeComponents: true — never estimate those ' +
  'values from a screenshot.';

// Mirrors the plugin-side cap: a very wide flat tree would otherwise produce a plan as unwieldy as
// the payload it replaces.
const MAX_PLAN_SECTIONS = 60;

const countNodes = (nodes: readonly DesignContextNode[]): number => {
  let total = 0;
  for (const node of nodes) {
    total += 1;
    if (node.children !== undefined) total += countNodes(node.children);
  }
  return total;
};

/**
 * Project a full node down to its compact shape (identity + geometry + structural flags), the same
 * fields the plugin's own compact detail emits — so a downgraded result is indistinguishable from
 * an explicit compact call, minus the second round-trip. Styling, text and token fields are dropped
 * by construction (only known-compact fields are copied).
 */
const projectToCompact = (node: DesignContextNode): DesignContextNode => {
  const out: DesignContextNode = { id: node.id, name: node.name, type: node.type };
  if (node.visible === false) out.visible = false;
  if (node.x !== undefined) out.x = node.x;
  if (node.y !== undefined) out.y = node.y;
  if (node.width !== undefined) out.width = node.width;
  if (node.height !== undefined) out.height = node.height;
  // The plugin sets an instance's mainComponentId at every detail level (only the resolved
  // mainComponent object is full-only), so the downgrade keeps instance→component identity too.
  if (node.mainComponentId !== undefined) out.mainComponentId = node.mainComponentId;
  if (node.truncated === true) out.truncated = true;
  if (node.deduped === true) out.deduped = true;
  if (node.children !== undefined) out.children = node.children.map(projectToCompact);
  return out;
};

/** The structure-only downgrade of an over-budget full payload (globalVars/tokens dropped). */
const compactDowngrade = (
  result: GetDesignContextResult,
  payloadChars: number,
): GetDesignContextResult => ({
  nodes: result.nodes.map(projectToCompact),
  ...(result.hint === undefined ? {} : { hint: result.hint }),
  note:
    `This tree serialized to ~${Math.round(payloadChars / 1000)}k chars at detail "full" — beyond ` +
    'what a tool result can deliver, so this is the structure-only (compact) view of the same ' +
    'tree. It carries no styling, text or tokens: pick each section and call get_design_context ' +
    'on its nodeId (detail: full, dedupeComponents: true) to ground it before building — never ' +
    'generate code from this structure alone.',
});

/**
 * Rebuild an oversized payload into a section plan: the roots' identity plus one entry per
 * top-level subtree to ground individually. Sections come from the single root's children (its
 * grandchildren when it only has one child — a page-like wrapper); a multi-root selection sections
 * at the roots. Returns null when the tree has nothing to split into (fewer than two sections) —
 * the caller then keeps the original payload, since a plan would strand the data without offering a
 * way forward.
 */
export const sectionPlanFromPayload = (
  result: GetDesignContextResult,
  payloadChars: number,
): GetDesignContextResult | null => {
  let sectionNodes: readonly DesignContextNode[] = result.nodes;
  for (let hops = 0; hops < 2 && sectionNodes.length === 1; hops += 1) {
    const only = sectionNodes[0] as DesignContextNode;
    if (only.children === undefined || only.children.length === 0) break;
    sectionNodes = only.children;
  }
  if (sectionNodes.length < 2) return null;

  const sections: DesignContextSection[] = sectionNodes.slice(0, MAX_PLAN_SECTIONS).map(node => ({
    nodeId: node.id,
    name: node.name,
    type: node.type,
    childCount: node.children?.length ?? 0,
    nodes: countNodes([node]),
  }));
  const omitted = sectionNodes.length - sections.length;
  return {
    nodes: result.nodes.map(node => ({ id: node.id, name: node.name, type: node.type })),
    sectionPlan: {
      reason: 'payload-size',
      payloadChars,
      sections,
      ...(omitted > 0 ? { sectionsOmitted: omitted } : {}),
    },
    note:
      `This tree serialized to ~${Math.round(payloadChars / 1000)}k chars — beyond what a tool ` +
      'result can deliver. Ground it section by section: call get_design_context per section ' +
      'nodeId (detail: full, dedupeComponents: true) and build each before moving on. Do not ' +
      'retry this call unscoped and do not depth-cap the whole page.',
  };
};

/**
 * The public MCP handler for get_design_context: apply the codegen-view defaults, dispatch armed
 * with budget, annotate raw colors with the project's tokens (the value-reverse join), then walk
 * the degradation cascade. `loadIndex` is injectable for tests; the default reads the server-cwd
 * project the same way token_map does.
 */
export const handleDesignContext = async (
  dispatch: ToolDispatcher,
  rawArgs: unknown,
  loadIndex: typeof loadTokenValueIndex = loadTokenValueIndex,
): Promise<GetDesignContextResult> => {
  // Parsing with the public shape also strips any caller-supplied `budget` key, so arming the
  // plugin bail stays exclusively this wrapper's decision.
  const args = z.object(getDesignContextTool.inputShape).parse(rawArgs ?? {});
  const detail = args.detail ?? 'full';
  const dedupeComponents = args.dedupeComponents ?? true;
  const raw = (await dispatch(getDesignContextTool.name, {
    ...args,
    detail,
    dedupeComponents,
    budget: true,
  })) as GetDesignContextResult;

  // The plugin's node-count bail already produced the plan — nothing further to measure.
  if (raw.sectionPlan !== undefined) return raw;

  // Value-reverse join, full detail only (below full there are no styling colors to annotate).
  // The annotated payload is the deliverable, so it's what the size nets measure; loadTokenValueIndex
  // never throws and returns an empty index off a non-web project, keeping this a no-op there.
  let result = raw;
  if (detail === 'full') {
    const { index, tailwind } = await loadIndex(process.cwd());
    result = annotateProjectTokens(raw, index, tailwind);
  }

  const payloadChars = JSON.stringify(result).length;
  if (payloadChars <= DESIGN_CONTEXT_CHAR_BUDGET) {
    return detail === 'full' ? result : { ...result, note: BELOW_FULL_NOTE };
  }

  if (detail === 'full') {
    const downgraded = compactDowngrade(result, payloadChars);
    if (JSON.stringify(downgraded).length <= DESIGN_CONTEXT_CHAR_BUDGET) return downgraded;
  }
  return sectionPlanFromPayload(result, payloadChars) ?? result;
};
