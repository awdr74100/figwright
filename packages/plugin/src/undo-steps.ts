import type { SandboxToolHandler } from './dispatcher.js';

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
 */
export const createUndoSteps = (
  figmaApi: Pick<PluginAPI, 'commitUndo'>,
): ((handler: SandboxToolHandler) => SandboxToolHandler) => {
  let tail: Promise<unknown> = Promise.resolve();
  return handler => params => {
    const run = tail.then(async () => {
      try {
        return await handler(params);
      } finally {
        try {
          figmaApi.commitUndo();
        } catch {
          // No undo history to commit to; the call's own outcome stands.
        }
      }
    });
    tail = run.catch(() => {});
    return run;
  };
};
