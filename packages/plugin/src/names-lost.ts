import { noteRuntimeError } from './runtime-ids.js';

/**
 * Whether a token, style or mode name was lost to Figma's plugin runtime running out of callback
 * ids (runtime-ids.ts). Every other failed lookup is an unresolved ref, skipped as it always was;
 * this one is not about the ref at all — the API itself has stopped answering this session (an API
 * first used after the overflow fails; measured on the variables API), so the result says so
 * instead of reading as a file whose bound values have no names.
 */
export interface NameLoss {
  spent: boolean;
}

export const createNameLoss = (): NameLoss => ({ spent: false });

/** Record a failed lookup's error; only the runtime's own overflow error counts as a loss. */
export const noteNameLoss = (loss: NameLoss, error: unknown): void => {
  if (noteRuntimeError(error)) loss.spent = true;
};

/** The hint a result carries when `what` names were lost that way. */
export const namesLostHint = (what: string): string =>
  `Some ${what} names could not be resolved: Figma's plugin runtime has run out of callback ids ` +
  'for this plugin session, so bound values here may lack their token names. Ask the user to ' +
  'close and reopen the Figwright plugin, then read again before generating code.';
