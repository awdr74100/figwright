import { useClipboard } from '@vueuse/core';

/**
 * Clipboard copy for the panel, with the one Figma-specific detail baked in so no call site can
 * forget it: `legacy: true` makes VueUse fall back to `document.execCommand` when the async
 * Clipboard API is unavailable — which it is inside the Figma plugin iframe. Without it, copy
 * buttons silently do nothing in Figma. `copied` flips true for ~1.5s after a successful copy.
 */
export const useCopyToClipboard = () => useClipboard({ legacy: true });
