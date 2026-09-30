import type { FlowStartingPoint, UpdateFlowsResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

const TOOL = 'update_flows';

// What a plugin cannot see, said in the message for asking after a flow that is not listed — the one
// place a caller meets it. Measured 2026-10-01: a flow whose frame is hidden, grouped or nested in
// another frame drops out of `flowStartingPoints` but is not deleted; it comes back under its old
// name once the frame is a visible top-level frame again — at its old position only if no write was
// made meanwhile — and no write can remove it until then. (A hidden section around the frame does
// not count — only the frame's own flag.)
const HIDDEN_FLOWS =
  'a flow whose starting frame is hidden, inside a group or nested in another frame is kept out of ' +
  'sight by Figma — plugins cannot list, rename or remove it until the frame is visible and ' +
  'top-level again';

interface Parsed {
  page: PageNode;
  flows: FlowStartingPoint[];
  remove: string[];
  order: string[];
}

export const readFlows = (page: PageNode): FlowStartingPoint[] =>
  page.flowStartingPoints.map(f => ({ nodeId: f.nodeId, name: f.name }));

export const sameFlows = (
  a: readonly FlowStartingPoint[],
  b: readonly FlowStartingPoint[],
): boolean =>
  a.length === b.length && a.every((f, i) => f.nodeId === b[i]!.nodeId && f.name === b[i]!.name);

/** Throw if `ids` names one id twice — every list here is keyed by frame id. */
const refuseRepeats = (ids: readonly string[], field: string): void => {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) throw new Error(`${TOOL}: ${field} names ${id} more than once`);
    seen.add(id);
  }
};

const parseIds = (raw: unknown, field: string): string[] => {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.some(id => typeof id !== 'string')) {
    throw new TypeError(`${TOOL}: ${field} must be an array of node ids`);
  }
  refuseRepeats(raw as string[], field);
  return raw as string[];
};

const parseFlows = (raw: unknown): FlowStartingPoint[] => {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new TypeError(`${TOOL}: flows must be an array`);
  const flows = raw.map((entry, i) => {
    const f = (entry ?? {}) as { nodeId?: unknown; name?: unknown };
    if (typeof f.nodeId !== 'string') {
      throw new TypeError(`${TOOL}: flows[${i}].nodeId must be a string`);
    }
    // Figma refuses an empty name itself, but only for the whole list and without saying which
    // entry; a name of spaces it accepts, so that is not refused here either.
    if (typeof f.name !== 'string' || f.name.length === 0) {
      throw new TypeError(`${TOOL}: flows[${i}].name must be a non-empty string`);
    }
    return { nodeId: f.nodeId, name: f.name };
  });
  refuseRepeats(
    flows.map(f => f.nodeId),
    'flows',
  );
  return flows;
};

const parse = async (figmaCtx: typeof figma, params: unknown): Promise<Parsed> => {
  const p = (params ?? {}) as {
    pageId?: unknown;
    flows?: unknown;
    remove?: unknown;
    order?: unknown;
  };
  if (typeof p.pageId !== 'string') throw new TypeError(`${TOOL}: pageId must be a string`);
  const flows = parseFlows(p.flows);
  const remove = parseIds(p.remove, 'remove');
  const order = parseIds(p.order, 'order');

  const page = await figmaCtx.getNodeByIdAsync(p.pageId);
  if (page === null) throw new Error(`${TOOL}: page ${p.pageId} not found`);
  if (page.type !== 'PAGE') {
    throw new Error(
      `${TOOL}: ${p.pageId} is a ${page.type}, not a page — get_pages lists page ids`,
    );
  }
  return { page, flows, remove, order };
};

/**
 * The list the call asks for, built from the list as it stands — or a refusal naming the argument
 * that cannot apply. Everything is checked here, before the one write, so a bad id leaves the page
 * as it was rather than half-changed.
 */
const plan = (current: readonly FlowStartingPoint[], args: Parsed): FlowStartingPoint[] => {
  const isFlow = new Set(current.map(f => f.nodeId));
  const removing = new Set(args.remove);

  for (const f of args.flows) {
    if (removing.has(f.nodeId)) {
      throw new Error(`${TOOL}: ${f.nodeId} is in both flows and remove`);
    }
  }
  for (const id of args.remove) {
    if (!isFlow.has(id)) {
      throw new Error(
        `${TOOL}: ${id} is not a flow starting point on page "${args.page.name}", so there is ` +
          `nothing to remove (${HIDDEN_FLOWS})`,
      );
    }
  }

  const named = new Map(args.flows.map(f => [f.nodeId, f.name]));
  const kept = current
    .filter(f => !removing.has(f.nodeId))
    .map(f => ({ nodeId: f.nodeId, name: named.get(f.nodeId) ?? f.name }));
  const added = args.flows.filter(f => !isFlow.has(f.nodeId));
  const next = [...kept, ...added];

  const willBeFlow = new Set(next.map(f => f.nodeId));
  for (const id of args.order) {
    if (!willBeFlow.has(id)) {
      throw new Error(
        `${TOOL}: order names ${id}, which is not a flow starting point after this call — add it ` +
          'through flows first',
      );
    }
  }
  const front = args.order.map(id => next.find(f => f.nodeId === id)!);
  const moved = new Set(args.order);
  return [...front, ...next.filter(f => !moved.has(f.nodeId))];
};

const pageOf = (node: BaseNode): PageNode | null => {
  let at: BaseNode | null = node;
  while (at !== null && at.type !== 'PAGE') at = at.parent;
  return at;
};

/**
 * Why a frame this call tried to make a flow could not be one. Consulted only once Figma has
 * refused or dropped an entry — Figma's own message names the rule but not the entry, and with
 * several frames added the caller cannot tell which to fix. Nothing is refused on these grounds up
 * front (bar the one case {@link refuseHidden} covers): that would be a hand-kept copy of Figma's
 * rule, and a stale copy turns away frames Figma would take.
 */
const diagnose = async (
  figmaCtx: typeof figma,
  page: PageNode,
  ids: readonly string[],
): Promise<string[]> => {
  const reasons = await Promise.all(
    ids.map(async id => {
      const node = await figmaCtx.getNodeByIdAsync(id);
      if (node === null) return `${id} does not exist`;
      if (node.type === 'PAGE' || node.type === 'DOCUMENT') return `${id} is a ${node.type}`;
      const home = pageOf(node);
      if (home !== null && home.id !== page.id) {
        return `${id} is on page "${home.name}", not "${page.name}"`;
      }
      const parent = node.parent;
      if (parent !== null && parent.type !== 'PAGE' && parent.type !== 'SECTION') {
        return `${id} (${node.type}) sits inside a ${parent.type}, and a flow starts on a top-level frame`;
      }
      if (node.type !== 'FRAME' && node.type !== 'COMPONENT' && node.type !== 'INSTANCE') {
        return `${id} is a ${node.type}, and a flow starts on a frame, component or instance`;
      }
      // The frame's own flag only: a frame in a hidden section is taken and listed (measured).
      if ('visible' in node && !node.visible) return `${id} is hidden`;
      return null;
    }),
  );
  return reasons.filter((r): r is string => r !== null);
};

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * Refuse, before anything is written, to make a hidden frame a flow.
 *
 * This is the one rule checked here rather than left to Figma, because it is the one Figma does not
 * enforce by refusing. Assigning a hidden frame raises no error; the entry is left out of the list
 * read back, yet kept — once the frame is shown it turns up as a flow (measured 2026-10-01).
 * Writing the old list back afterwards cannot undo that, since a write only ever sets the flows a
 * plugin can see, so the only way to leave the page as it was is not to write. Only the frame's own
 * flag counts: a frame whose section is hidden is taken and listed like any other.
 */
const refuseHidden = async (
  figmaCtx: typeof figma,
  page: PageNode,
  ids: readonly string[],
): Promise<void> => {
  const hidden = await Promise.all(
    ids.map(async id => {
      const node = await figmaCtx.getNodeByIdAsync(id);
      return node !== null && 'visible' in node && !node.visible ? id : null;
    }),
  );
  const named = hidden.filter((id): id is string => id !== null);
  if (named.length === 0) return;
  throw new Error(
    `${TOOL}: ${named.join(', ')} ${named.length === 1 ? 'is' : 'are'} hidden, so the flows on ` +
      `page "${page.name}" were left unchanged — Figma takes a hidden frame without an error but ` +
      'keeps its flow out of sight, where no plugin can rename or remove it, until the frame is ' +
      'shown. Show the frame first (set_visible)',
  );
};

/**
 * Rename, add, remove and reorder the prototype flows on one page.
 *
 * Figma exposes flows as a single list assigned whole, so this reads the list, applies the change
 * and assigns it back — the caller names only the flows it means to touch, and every other flow
 * keeps its name and place. A whole-list argument would have been the thinner wrapper, but it turns
 * "rename one of fifteen" into a call that silently deletes fourteen whenever the list is restated
 * short.
 *
 * Figma checks the list itself (a flow must start on a top-level frame, component or instance on
 * this page) and refuses it whole on any bad entry. What it does not refuse is a hidden frame, so
 * that one case is checked first ({@link refuseHidden}). The list is also read back after every
 * write, for whatever else Figma may take without taking: a result that differs from the request is
 * reported rather than answered with `ok: true`, and the flows a plugin can see are put back.
 */
export const createUpdateFlowsHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const args = await parse(figmaCtx, params);
    const { page } = args;
    // Every await comes before the list is read. The editor keeps running while this handler
    // waits, so a list read before an await can be stale by the write — and writing it would
    // silently drop a flow the user added meanwhile. Checking every frame named, not just the
    // ones that turn out to be new, is what lets this happen first: a frame already a flow is
    // visible by definition, so the wider check refuses nothing more.
    await refuseHidden(
      figmaCtx,
      page,
      args.flows.map(f => f.nodeId),
    );

    const current = readFlows(page);
    const next = plan(current, args);
    const added = next.filter(f => !current.some(c => c.nodeId === f.nodeId)).map(f => f.nodeId);

    if (!sameFlows(current, next)) {
      try {
        page.flowStartingPoints = next;
      } catch (e) {
        const reasons = await diagnose(figmaCtx, page, added);
        throw new Error(
          `${TOOL}: Figma refused the new flow list for page "${page.name}", which is unchanged ` +
            `(${errorText(e)})` +
            (reasons.length > 0 ? ` — ${reasons.join('; ')}` : ''),
          { cause: e },
        );
      }

      const landed = readFlows(page);
      if (!sameFlows(landed, next)) {
        // Put back first, in the same tick as the write; only then look into why.
        let restored = true;
        try {
          page.flowStartingPoints = current;
        } catch {
          restored = false;
        }
        const dropped = next.filter(f => !landed.some(l => l.nodeId === f.nodeId));
        const reasons = await diagnose(
          figmaCtx,
          page,
          dropped.map(f => f.nodeId),
        );
        const what =
          dropped.length > 0
            ? `Figma accepted the list but dropped ${dropped.map(f => f.nodeId).join(', ')}` +
              (reasons.length > 0 ? ` (${reasons.join('; ')})` : '')
            : 'Figma accepted the list but reads it back differently';
        // "Put back" covers only what a write can reach: had Figma kept a dropped entry out of
        // sight, as it does for a hidden frame, no write could remove it — so this says so.
        throw new Error(
          `${TOOL}: ${what}. ` +
            (restored
              ? `The flows listed on page "${page.name}" were put back as they were, but Figma ` +
                'may still hold a dropped entry out of sight and list it once its frame qualifies'
              : `The flows on page "${page.name}" could not be put back and now read ` +
                JSON.stringify(readFlows(page))),
        );
      }
    }

    const result: UpdateFlowsResult = { ok: true, pageId: page.id, flows: readFlows(page) };
    return result;
  };
