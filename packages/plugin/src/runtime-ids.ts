/**
 * Whether Figma's plugin runtime has run out of callback ids this plugin session (grid-tracks.ts
 * has the measurements). The counter never resets while the plugin runs, so once it has overflowed,
 * every later call that makes an object with its own native functions fails — grid tracks and
 * images were measured, whether or not the session had used them before — and each such failed call
 * spends more ids, taking the counter on towards the wrap where those functions invoke unrelated
 * API functions. Code that makes those objects checks this before making one.
 *
 * Set only by the runtime's own error, from wherever it surfaces first: a track read, a name
 * lookup, or any handler error the dispatcher sees.
 */
let spent = false;

// The overflowed counter is the only source measured, and its ids are negative (int16 past
// 32,767); any other wording is left to propagate as it always did.
const CALLBACK_IDS_SPENT = /Attempted to invoke callback with invalid id -\d/;

/** Whether an error is the runtime reporting its callback ids spent. */
const isCallbackIdsSpent = (message: string): boolean => CALLBACK_IDS_SPENT.test(message);

/** Mark the session spent if `error` is the runtime's overflow error; returns whether it was. */
export const noteRuntimeError = (error: unknown): boolean => {
  const overflowed = isCallbackIdsSpent(error instanceof Error ? error.message : String(error));
  if (overflowed) spent = true;
  return overflowed;
};

export const isRuntimeSpent = (): boolean => spent;

/** What an agent needs instead: retrying cannot work, and the one step that recovers is the user's. */
export const RUNTIME_SPENT_NOTE =
  "Figma's plugin runtime has run out of callback ids for this plugin session, and only " +
  'reopening the Figwright plugin resets them: retrying fails the same way, and Figma APIs this ' +
  'session had not used yet can fail too. Ask the user to close and reopen the plugin.';

/**
 * The error a handler throws instead of making an object that would fail — `what` says what it
 * would have made. Thrown before the object exists, so the refusal spends no ids.
 */
export const runtimeSpentError = (tool: string, what: string): Error =>
  new Error(`${tool}: could not ${what}. ${RUNTIME_SPENT_NOTE}`);

/** Test seam: start a fresh plugin session. */
export const resetRuntimeForTests = (): void => {
  spent = false;
};
