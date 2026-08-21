import {
  DESIGN_CONTEXT_TOKEN_BUDGET,
  type DesignContextNode,
  type DesignContextSection,
  estimateResultTokens,
  type GetDesignContextResult,
} from '@figwright/shared';

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
//   full over budget, layout+content fits    → LAYOUT + text/props projection + note
//   still over, tree splits into sections    → section plan (ground each section at FULL)
//   unsplittable, layout alone fits          → LAYOUT projection (text/props dropped) + note
//   unsplittable, only geometry fits         → compact projection (geometry only) + note
//   nothing fits and nothing to split        → the payload as-is (a plan would strand the caller)
//   tree too large to even serialize (bail)  → section plan straight from the plugin, pre-work
//
// The plugin's pre-serialization bail is armed with budget: true (the coarse net); the mcp-side
// token budget is the precise net (see DESIGN_CONTEXT_TOKEN_BUDGET for the measurements behind it)
// — beyond it the result errors out and delivers nothing, so every downgrade replaces a dead end,
// never a working result.
//
// Section plan BEFORE the smaller projections is the important ordering. A section plan is not a
// lesser result: each section, grounded on its own, comes back at FULL detail with its layout AND
// its colour, type and tokens — strictly more than any whole-tree projection that had to drop half
// its fields to fit. The projections exist for the trees a plan cannot help: a single deep subtree
// with nothing to split into. Putting geometry-only ahead of the plan is what made the tool hand
// back a coordinate dump that looked usable and was not.
//
// The LAYOUT tier exists because the cascade used to jump straight from full to geometry-only, and
// geometry-only is precisely the input that makes a model emit absolute offsets and per-child
// margins instead of the container's own flex/grid, padding and gap — the design's structure
// survives in the tree but its layout system does not (issue #161). That jump also threw away far
// more than the budget required: measured on real over-budget sections, full ran 153k–158k chars
// while the same tree keeping every layout field ran 87k–96k — comfortably inside the budget the
// old downgrade was shedding styling to reach. So the tier keeps what defines the BOX MODEL and the
// FLOW (and what the element says) and drops only APPEARANCE — colours, typography, effects, token
// bindings — which is the half a caller can re-ground per section, and the half that is expensive.
// When even the layout tier does not fit, sectioning takes over; the layout-only and geometry-only
// rungs remain for unsplittable trees, and there text/props are shed before layout — letting the
// ~15% that text costs push a result off the layout rung would trade the whole box model for some
// strings.

export type ToolDispatcher = (toolName: string, args: unknown) => Promise<unknown>;

const BELOW_FULL_NOTE =
  'Styling, layout, text and design-token fields are omitted below detail "full". For code ' +
  'generation call again with detail: "full" and dedupeComponents: true — never estimate those ' +
  'values from a screenshot, and never reconstruct spacing from x/y as per-child margins.';

/**
 * Attach a note as the FIRST key of the result. JSON.stringify preserves insertion order and the
 * consumer is a model reading the payload top to bottom, so a caveat emitted after the nodes lands
 * at the very end of the text — measured at 98–99% of the way through a real downgraded payload,
 * i.e. after every tempting coordinate it is warning about. Leading it costs nothing and is the
 * difference between a caveat that is read before the data and one that is read after.
 */
const withLeadingNote = (result: GetDesignContextResult, note: string): GetDesignContextResult => {
  const { note: superseded, ...rest } = result;
  void superseded;
  return { note, ...rest };
};

/** Does this shape survive the net? */
const fits = (candidate: GetDesignContextResult): boolean =>
  estimateResultTokens(JSON.stringify(candidate)) <= DESIGN_CONTEXT_TOKEN_BUDGET;

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
 * The box model and the flow: everything that decides how a node is sized, placed and spaced. This
 * is the half whose absence makes a caller rebuild spacing out of coordinates, so it is the last
 * thing shed — it survives even when the content below has to go.
 */
const LAYOUT_FIELDS = [
  // Auto-layout / grid: the container's own flex or grid system.
  'layout',
  'layoutGrids',
  // How this node sizes and places itself inside its parent's layout.
  'layoutSizingHorizontal',
  'layoutSizingVertical',
  'layoutGrow',
  'layoutAlign',
  'layoutPositioning',
  'gridChild',
  'minWidth',
  'maxWidth',
  'minHeight',
  'maxHeight',
  'targetAspectRatio',
  // Placement of a child of a NON-auto-layout frame: the resize anchor, not just x/y.
  'constraints',
  // Clipping / scrolling / sticky children — overflow behaviour is layout, not paint.
  'clipsContent',
  'overflowDirection',
  'numberOfFixedChildren',
] as const satisfies readonly (keyof DesignContextNode)[];

/**
 * What the element says and which variant it renders — content, not appearance. Kept alongside the
 * layout whenever it fits, but shed one rung earlier: text is ~15% of a tier payload, and letting
 * that 15% push the result off the layout rung would trade the entire box model for some strings.
 */
const CONTENT_FIELDS = [
  'characters',
  'textAutoResize',
  'textAlignHorizontal',
  'textAlignVertical',
  'textTruncation',
  'maxLines',
  'textOverrides',
  // Which variant an instance renders — an INSTANCE without its props is not buildable.
  'componentProperties',
  // The designer's Dev Mode notes: explicit instructions that outrank inference, so dropping them
  // while keeping geometry would be backwards.
  'annotations',
] as const satisfies readonly (keyof DesignContextNode)[];

/**
 * Everything a downgrade may keep beyond the compact base — the union of the two groups above, and
 * the surface the drift ratchet checks.
 *
 * Hand-listed on purpose, and ratcheted by a test against DesignContextNodeSchema: this repo's most
 * recurring bug class is a new dimension landing in the serializer and silently missing from a
 * hand-copied projection. The test forces every new schema field to be either listed here or
 * explicitly classified as appearance, so the tier can never quietly stop carrying a layout field.
 */
export const LAYOUT_TIER_FIELDS = [
  ...LAYOUT_FIELDS,
  ...CONTENT_FIELDS,
] as const satisfies readonly (keyof DesignContextNode)[];

const LAYOUT_AND_CONTENT_SET = new Set<string>(LAYOUT_TIER_FIELDS);
const LAYOUT_ONLY_SET = new Set<string>(LAYOUT_FIELDS);

/**
 * Project a full node down to its compact shape (identity + geometry + structural flags), the same
 * fields the plugin's own compact detail emits — so a downgraded result is indistinguishable from
 * an explicit compact call, minus the second round-trip. Styling, text and token fields are dropped
 * by construction (only known-compact fields are copied).
 *
 * `extraFields` adds the LAYOUT tier on top of that same base; passing none yields the
 * geometry-only shape. Copying only known-good keys (rather than deleting known-bad ones) is what
 * keeps a newly added appearance field from leaking into a downgrade by default.
 */
const projectToCompact = (
  node: DesignContextNode,
  extraFields?: ReadonlySet<string>,
): DesignContextNode => {
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
  if (extraFields !== undefined) {
    const src = node as unknown as Record<string, unknown>;
    const dst = out as unknown as Record<string, unknown>;
    for (const key of extraFields) {
      if (src[key] !== undefined) dst[key] = src[key];
    }
  }
  if (node.children !== undefined) {
    out.children = node.children.map(child => projectToCompact(child, extraFields));
  }
  return out;
};

const overBudgetLead = (payloadChars: number): string =>
  `This tree serialized to ~${Math.round(payloadChars / 1000)}k chars at detail "full" — beyond ` +
  'what a tool result can deliver, so ';

/** The shared closing rule: whatever survived, structure comes from layout and never from x/y. */
const REGROUND_RULE =
  'Build the structure from the layout objects, never from x/y: emit the container and its ' +
  'gap/padding, not per-child margins or absolute offsets. To get what is missing, call ' +
  'get_design_context per section nodeId (detail: full, dedupeComponents: true) before building ' +
  'that section — never estimate those values from a screenshot.';

/**
 * The LAYOUT downgrade of an over-budget full payload: the whole tree with its box model, flow and
 * (on the first rung) text content intact, and only appearance dropped. This is the rung that keeps
 * a model emitting real containers (flex/grid + padding + gap) instead of reconstructing spacing
 * from x/y as per-child margins.
 *
 * `withContent` is the first, more complete rung; the second drops text/props so a tree that only
 * just misses can still keep its whole layout rather than collapsing to bare geometry.
 */
const layoutDowngrade =
  (withContent: boolean) =>
  (result: GetDesignContextResult, payloadChars: number): GetDesignContextResult => ({
    note:
      overBudgetLead(payloadChars) +
      'this is the same tree with its LAYOUT intact and its APPEARANCE dropped. Every frame still ' +
      'carries its exact layout (flex/grid mode, padding, itemSpacing/gap, alignment) and each ' +
      'node its sizing and constraints' +
      (withContent
        ? ', and each text its characters. What is missing is colour, typography, effects and '
        : '. What is missing is text content, colour, typography, effects and ') +
      'token bindings. ' +
      REGROUND_RULE,
    nodes: result.nodes.map(node =>
      projectToCompact(node, withContent ? LAYOUT_AND_CONTENT_SET : LAYOUT_ONLY_SET),
    ),
    ...(result.hint === undefined ? {} : { hint: result.hint }),
  });

/** The structure-only downgrade of an over-budget full payload (globalVars/tokens dropped). */
const compactDowngrade = (
  result: GetDesignContextResult,
  payloadChars: number,
): GetDesignContextResult => ({
  note:
    overBudgetLead(payloadChars) +
    'and too large even with layout alone, this is the structure-only (compact) view of the same ' +
    'tree. It carries no layout, styling, text or tokens, so it is a MAP, not a spec: use it to ' +
    'pick sections, never to generate from. Call get_design_context on each section nodeId ' +
    '(detail: full, dedupeComponents: true) to ground it before building — and in particular do ' +
    'not turn the x/y deltas here into margins, since the spacing they encode belongs to a layout ' +
    'you have not been given.',
  nodes: result.nodes.map(node => projectToCompact(node)),
  ...(result.hint === undefined ? {} : { hint: result.hint }),
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
    note:
      `This tree serialized to ~${Math.round(payloadChars / 1000)}k chars — beyond what a tool ` +
      'result can deliver. Ground it section by section: call get_design_context per section ' +
      'nodeId (detail: full, dedupeComponents: true) and build each before moving on. Do not ' +
      'retry this call unscoped and do not depth-cap the whole page.',
    nodes: result.nodes.map(node => ({ id: node.id, name: node.name, type: node.type })),
    sectionPlan: {
      reason: 'payload-size',
      payloadChars,
      sections,
      ...(omitted > 0 ? { sectionsOmitted: omitted } : {}),
    },
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
  const args = getDesignContextTool.inputSchema.parse(rawArgs ?? {});
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
    const { index, utilityFirst } = await loadIndex(process.cwd());
    result = annotateProjectTokens(raw, index, utilityFirst);
  }

  const serialized = JSON.stringify(result);
  const payloadChars = serialized.length;
  if (estimateResultTokens(serialized) <= DESIGN_CONTEXT_TOKEN_BUDGET) {
    return detail === 'full' ? result : withLeadingNote(result, BELOW_FULL_NOTE);
  }

  if (detail === 'full') {
    // One rung of over-budget: shed appearance but keep the whole tree, its layout and its text.
    // Cheaper than N round trips and still enough to build correct containers.
    const withEverythingButAppearance = layoutDowngrade(true)(result, payloadChars);
    if (fits(withEverythingButAppearance)) return withEverythingButAppearance;

    // Genuinely too big for one call. Sectioning beats any further projection: each section comes
    // back at FULL detail — layout AND colour AND type — instead of a whole tree missing half its
    // fields. Only a tree with nothing to split into falls past this.
    const plan = sectionPlanFromPayload(result, payloadChars);
    if (plan !== null) return plan;

    // Unsplittable: keep shedding, layout last.
    for (const downgrade of [layoutDowngrade(false), compactDowngrade]) {
      const downgraded = downgrade(result, payloadChars);
      if (fits(downgraded)) return downgraded;
    }
    return result;
  }

  // Below full there is no cheaper projection to try — straight to the plan.
  return sectionPlanFromPayload(result, payloadChars) ?? result;
};
