import { postToSandbox } from './panel-window.js';

/**
 * Ask the sandbox to select and frame these nodes (see src/reveal.ts). Fire-and-forget: the sandbox
 * owns the document and reports a miss to the user itself, so there's nothing to await here.
 */
export const revealOnCanvas = (nodeIds: readonly string[]): void => {
  if (nodeIds.length === 0) return;
  postToSandbox({ type: 'ui:reveal', nodeIds: [...nodeIds] });
};
