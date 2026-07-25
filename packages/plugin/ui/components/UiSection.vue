<script setup lang="ts">
import UiSectionHeading from './UiSectionHeading.vue';

defineProps<{
  /** Omitted for a lead-in block that needs no heading of its own. */
  title?: string;
}>();
</script>

<!--
  One titled block within a tab.

  It owns its vertical rhythm but not the rule above it: siblings are separated by the parent's
  `divide-y divide-line`, so a section never has to know whether it happens to be first. That's what
  `first:pt-0 last:pb-0` is for — the outer edges stay flush against the tab's own padding while the
  seams between sections keep their breathing room.
-->
<template>
  <section class="pt-2.5 pb-3.5 first:pt-0 last:pb-0">
    <UiSectionHeading v-if="title !== undefined" class="mb-1.5">{{ title }}</UiSectionHeading>
    <slot />
  </section>
</template>
