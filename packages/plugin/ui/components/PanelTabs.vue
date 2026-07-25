<script setup lang="ts">
import { computed } from 'vue';

import { type Tab, TABS } from '../lib/tabs.js';

const active = defineModel<Tab>({ required: true });

// Drives the sliding indicator — its offset is the active tab's index, so the pill animates between
// positions instead of the highlight jumping.
const activeIndex = computed(() => TABS.findIndex(([id]) => id === active.value));
</script>

<template>
  <nav class="relative grid grid-cols-3 gap-1">
    <!--
      The indicator's geometry is coupled to this nav's `grid-cols-3 gap-1` (gap = 0.25rem):
      width = (track − 2 gaps) / 3 columns; each step = one column + one gap. Keep these in sync if
      the column count or gap ever changes.
    -->
    <span
      class="absolute inset-y-0 left-0 rounded-md bg-raised transition-transform duration-200 ease-standard"
      :style="{
        width: 'calc((100% - 0.5rem) / 3)',
        transform: `translateX(calc(${activeIndex} * (100% + 0.25rem)))`,
      }"
    />
    <button
      v-for="[id, label] in TABS"
      :key="id"
      class="relative rounded-md py-1 text-panel transition-colors duration-150"
      :class="active === id ? 'font-medium text-fg' : 'text-dim hover:text-fg'"
      @click="active = id"
    >
      {{ label }}
    </button>
  </nav>
</template>
