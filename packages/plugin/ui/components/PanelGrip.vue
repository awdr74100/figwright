<script setup lang="ts">
import { usePanelWindow } from '../composables/usePanelWindow.js';

const { onResizeStart, onResizeMove, onResizeEnd } = usePanelWindow();
</script>

<!--
  Figma gives plugin windows no resize affordance, so the panel draws its own: the diagonal stair
  every platform uses for a resize corner (a textarea's native grippy, an OS window corner).

  Leaning on that convention is the whole point — the mark has to be recognised as "drag me" at a
  glance, at 16px, in a tertiary colour. The two chords also run along the drag axis itself, so the
  glyph points the same way `cursor-nwse-resize` does.

  Two strokes of clearly different length (12.7 and 5.7), 3.5px apart. Both numbers are
  load-bearing, and both were got wrong first:

  - The corner clips more than it looks like it does. Figma's window corner is not an 8px radius but
    a squircle reaching 11px along each edge; measured off a real screenshot, the visible boundary
    crosses the diagonal at (12.25, 12.25) in this box. A chord whose midpoint sits past that is cut
    in half and effectively disappears — which is what happened to the short one at a 1.75px inset.
  - The gap has to survive a 1x display. At 1.5px wide and 2.5px apart the two strokes'
    anti-aliasing fills the space between them and they read as one solid wedge.

  So: endpoints inset 4px, chords at x+y=15 and x+y=20. 2px was tried and is too far out — the
  short chord goes back to looking swallowed by the corner there, even though the arithmetic says
  only a quarter of its width is lost. Screenshots at device scale 2 hide that entirely; check this
  in the real window, not in a render.
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
      <!-- long chord, then the short one nearer the corner -->
      <path d="M12 3 L3 12" />
      <path d="M12 8 L8 12" />
    </svg>
  </div>
</template>
