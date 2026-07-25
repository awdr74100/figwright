<script setup lang="ts">
import { usePanelWindow } from '../composables/usePanelWindow.js';

const { onResizeStart, onResizeMove, onResizeEnd } = usePanelWindow();
</script>

<!--
  Figma gives plugin windows no resize affordance, so the panel draws its own: a single stroke
  tucked into the corner.

  It curves the same way the window's corner does — concentric with it — so the mark belongs to a
  rounded window instead of fighting it. (Curving *around* the corner instead would read as
  radiating waves, which is the empty state's language, not this one's.)

  Everything is held clear of the corner itself. Figma rounds the plugin window and doesn't expose
  the radius; past roughly (12,12) in this 16px box the pixels fall outside the window at a 13px
  radius and the glyph would render clipped. This geometry stays inside for any radius Figma is
  plausibly using.
-->
<template>
  <div
    class="absolute right-0 bottom-0 size-4 cursor-nwse-resize touch-none text-faint transition-colors duration-150 hover:text-fg"
    title="Drag to resize"
    @pointerdown="onResizeStart"
    @pointermove="onResizeMove"
    @pointerup="onResizeEnd"
    @pointercancel="onResizeEnd"
  >
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      class="size-4"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
    >
      <path d="M12 3A9 9 0 0 1 3 12" />
    </svg>
  </div>
</template>
