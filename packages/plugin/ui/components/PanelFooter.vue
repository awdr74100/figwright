<script setup lang="ts">
import { ArrowDownToLine } from '@lucide/vue';

import { usePanelWindow } from '../composables/usePanelWindow.js';

defineProps<{ version: string; totalCalls: number; failedCalls: number }>();

const { runInBackground } = usePanelWindow();
</script>

<template>
  <footer
    class="flex shrink-0 items-center gap-1.5 border-t border-line px-3 py-1.5 text-[10px] text-faint"
  >
    <!-- No product name: Figma's own plugin window titles this panel "Figwright" already, and the
         footer is the tightest row in the UI. -->
    <span class="truncate">v{{ version }}</span>
    <span aria-hidden="true" class="opacity-50">·</span>
    <span class="shrink-0 tabular-nums">{{ totalCalls }} calls</span>
    <!-- Only when something actually failed: a permanent "0 failed" would be noise on every
         healthy session, and the point of the number is to catch your eye when it isn't zero. -->
    <template v-if="failedCalls > 0">
      <span aria-hidden="true" class="opacity-50">·</span>
      <span class="shrink-0 tabular-nums text-danger">{{ failedCalls }} failed</span>
    </template>
    <button
      class="ml-auto flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 transition-colors duration-150 hover:bg-hover hover:text-fg"
      title="Run in background — hides the panel; the relay stays connected. Reopen by running the plugin again."
      @click="runInBackground"
    >
      <ArrowDownToLine class="size-3" />
      Background
    </button>
  </footer>
</template>
