<script setup lang="ts">
defineProps<{ version: string; totalCalls: number; failedCalls: number }>();
</script>

<template>
  <footer
    class="flex shrink-0 items-center gap-1.5 border-t border-line px-3 py-1.5 text-meta text-faint"
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
      <span class="shrink-0 text-danger tabular-nums">{{ failedCalls }} failed</span>
    </template>
  </footer>
</template>
