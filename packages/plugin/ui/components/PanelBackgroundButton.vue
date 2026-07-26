<script setup lang="ts">
import { Minimize2 } from '@lucide/vue';

import { usePanelWindow } from '../composables/usePanelWindow.js';

const { runInBackground } = usePanelWindow();
</script>

<!--
  Running in the background hides the panel and keeps the relay connected — it is a window control,
  the near cousin of Figma's own ✕ (which disconnects). So it lives where window controls live: the
  top-right, below Figma's title bar rather than in the footer's read-only status row. That also
  hands the bottom-right corner back to <PanelGrip>, which every resizable window reserves for its
  resize handle.

  Icon-only out of necessity: at the 280px minimum panel width, a labelled button plus the status
  text plus ":3055 · up 15m" doesn't fit, so the tooltip has to carry the "stays connected" part.

  `minimize-2`, the standard collapse-inward glyph, because sitting directly under Figma's ✕ it
  reads as the other half of a window-control pair and says "put this window away" rather than
  "collapse this section" (a bare minus) or "download" (a down arrow). Its diagonals were a worry —
  <PanelGrip> is also diagonal — but they point inward from two corners where the grip is a pair of
  parallel strokes, and the two sit at opposite ends of the panel; checked in Figma, they don't read
  as the same thing. Don't swap in `eye-off` or `panel-bottom-close`: at 12px their paths mush.

  Sizes are set against the status row rather than in the abstract — 12px matches the visual height
  of the 11px label beside it, and the negative margin lets the hit target exceed the text without
  growing the header.
-->
<template>
  <button
    class="-my-1 shrink-0 rounded p-1 text-faint transition-colors duration-150 hover:bg-hover hover:text-fg"
    title="Run in background — hides the panel; the relay stays connected. Reopen by running the plugin again."
    aria-label="Run in background"
    @click="runInBackground"
  >
    <Minimize2 class="size-3" />
  </button>
</template>
