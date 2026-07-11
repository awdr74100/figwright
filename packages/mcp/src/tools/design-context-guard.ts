import {
  DESIGN_CONTEXT_CHAR_BUDGET,
  type DesignContextNode,
  type DesignContextSection,
  type GetDesignContextResult,
} from '@figwright/shared';
import { z } from 'zod';

import { getDesignContextTool } from './get-design-context.js';

// The public-path guard around get_design_context, the hot grounding read. Internal consumers
// (design_diff snapshots, component/icon map walks) dispatch the tool directly and are untouched;
// this wrapper only runs for the MCP tool call, where the result lands in an LLM context:
//
// 1. It marks the dispatch with budget: true, arming the plugin's pre-serialization node-count
//    bail (the coarse net — a hopeless tree skips the heavy work and returns a section plan).
// 2. It measures the returned payload and, past DESIGN_CONTEXT_CHAR_BUDGET, replaces it with a
//    section plan built from the payload itself (the precise net). Beyond that budget the result
//    errors out of Claude Code's default MCP result cap today and delivers nothing, so a plan is
//    strictly an upgrade, not a downgrade.
// 3. On a below-full detail it attaches a one-line note pointing codegen callers at detail 'full' —
//    the tool result is the one guidance surface every caller is guaranteed to read.

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

/** The public MCP handler for get_design_context: dispatch armed with budget, then apply the nets. */
export const handleDesignContext = async (
  dispatch: ToolDispatcher,
  rawArgs: unknown,
): Promise<GetDesignContextResult> => {
  // Parsing with the public shape also strips any caller-supplied `budget` key, so arming the
  // plugin bail stays exclusively this wrapper's decision.
  const args = z.object(getDesignContextTool.inputShape).parse(rawArgs ?? {});
  const result = (await dispatch(getDesignContextTool.name, {
    ...args,
    budget: true,
  })) as GetDesignContextResult;

  if (result.sectionPlan !== undefined) return result;

  if ((args.detail ?? 'compact') !== 'full') return { ...result, note: BELOW_FULL_NOTE };

  const payloadChars = JSON.stringify(result).length;
  if (payloadChars > DESIGN_CONTEXT_CHAR_BUDGET) {
    return sectionPlanFromPayload(result, payloadChars) ?? result;
  }
  return result;
};
