import { BUDGET_LAYER_MARGIN_MS, DEFAULT_TOOL_BUDGET_MS } from '@figwright/shared';

import type { SandboxToolHandler } from './dispatcher.js';

/**
 * How long a write may hold the queue. Past this it is taken to be stuck — a fetch that never
 * answers (measured: a create_instance by key hung in FigJam, and every write queued behind it
 * timed out until the plugin was reloaded) — and the writes behind it go ahead. Two layer margins
 * short of the default budget, so a write that waited the whole time still has ten seconds of its
 * own window to run in, where a few milliseconds is the norm.
 */
export const QUEUE_RELEASE_MS = DEFAULT_TOOL_BUDGET_MS - 2 * BUDGET_LAYER_MARGIN_MS;

/**
 * One Cmd+Z step per write call.
 *
 * Figma leaves a plugin's edits out of the undo history until `commitUndo()` is called, and this
 * plugin stays open for the whole session — so, measured in Figma Design and FigJam, a single Cmd+Z
 * reverted every edit the plugin had made since it opened, the agent's whole build at once. Each
 * write now closes a step when it finishes, so Cmd+Z takes back one tool call (a batch is one call)
 * and the user's own edits between calls stay their own steps.
 *
 * Writes run one at a time. `commitUndo()` closes a step on whatever has changed since the last
 * one, and the relay sends calls concurrently: two writes interleaving across their awaits would
 * otherwise split each other, and a Cmd+Z could take back half of one. Reads are not queued — they
 * change nothing a step could hold.
 *
 * A write that throws still closes its step, so whatever it changed before failing undoes on its
 * own rather than with the next call. A commit that fails (an editor without an undo history) is
 * ignored: it must never replace the tool's own result or error.
 *
 * A write still running after {@link QUEUE_RELEASE_MS} closes its step there and lets the queue
 * move: a stuck write must not hold every later one. Whatever it does after that lands in whichever
 * step is open when it does, and it closes none itself — a commit at an arbitrary later moment
 * would cut another write's step in two.
 */
export const createUndoSteps = (
  figmaApi: Pick<PluginAPI, 'commitUndo'>,
): ((handler: SandboxToolHandler) => SandboxToolHandler) => {
  const commit = (): void => {
    try {
      figmaApi.commitUndo();
    } catch {
      // No undo history to commit to; the call's own outcome stands.
    }
  };
  let tail: Promise<void> = Promise.resolve();
  return handler => params => {
    let release!: () => void;
    const slot = new Promise<void>(resolve => {
      release = resolve;
    });
    const previous = tail;
    tail = slot;
    return previous.then(async () => {
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        commit();
        release();
      }, QUEUE_RELEASE_MS);
      try {
        return await handler(params);
      } finally {
        clearTimeout(timer);
        if (!timedOut) {
          commit();
          release();
        }
      }
    });
  };
};
