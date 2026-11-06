import { BUDGET_LAYER_MARGIN_MS, DEFAULT_TOOL_BUDGET_MS } from '@figwright/shared';

import type { SandboxToolHandler } from './dispatcher.js';

/**
 * How long a write counts as running. Past this it is taken to be stuck — a fetch that never
 * answers (measured: a create_instance by key hung in FigJam) — and stops holding back the step the
 * other writes close. Two layer margins short of the default budget: by then the caller's own timer
 * is about to give up on it.
 */
export const STALE_WRITE_MS = DEFAULT_TOOL_BUDGET_MS - 2 * BUDGET_LAYER_MARGIN_MS;

/**
 * One Cmd+Z step per write call, or per run of writes that overlap.
 *
 * Figma leaves a plugin's edits out of the undo history until `commitUndo()` is called, and this
 * plugin stays open for the whole session — so, measured in Figma Design and FigJam, a single Cmd+Z
 * reverted every edit the plugin had made since it opened, the agent's whole build at once.
 *
 * `commitUndo()` closes a step on whatever has changed since the last one, so it runs when the last
 * running write finishes: a write on its own is one step, and writes the relay sent at once share
 * one — a commit while another write was still mid-way would cut that write in two, and a Cmd+Z
 * would take back half of it. Writes are not made to wait for each other: queueing them instead
 * (measured) let one stuck write time out every write behind it, and made fifteen 2.5 s writes sent
 * together run one after another until the last four hit the 30 s timeout. So nothing here delays a
 * call; at worst, overlapping calls undo together. Reads change nothing a step could hold and are
 * not counted.
 *
 * A write that throws still counts as finishing, so whatever it changed before failing is closed
 * with it. A write still running after {@link STALE_WRITE_MS} stops counting, so it cannot hold the
 * others' step open; whatever it does after that lands in whichever step is open then, and its
 * finishing closes none. A commit that fails (an editor without an undo history) is ignored: it
 * must never replace the call's own result or error.
 */
export const createUndoSteps = (
  figmaApi: Pick<PluginAPI, 'commitUndo'>,
): ((handler: SandboxToolHandler) => SandboxToolHandler) => {
  const running = new Set<symbol>();
  const settle = (write: symbol): void => {
    if (!running.delete(write) || running.size > 0) return;
    try {
      figmaApi.commitUndo();
    } catch {
      // No undo history to commit to; the call's own outcome stands.
    }
  };
  return handler => async params => {
    const write = Symbol('write');
    running.add(write);
    const stale = setTimeout(() => settle(write), STALE_WRITE_MS);
    try {
      return await handler(params);
    } finally {
      clearTimeout(stale);
      settle(write);
    }
  };
};
