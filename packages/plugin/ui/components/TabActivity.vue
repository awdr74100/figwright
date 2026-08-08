<script setup lang="ts">
import { Radio } from '@lucide/vue';

import type { ActivityEntry } from '../relay/state.js';
import TabActivityRow from './TabActivityRow.vue';

defineProps<{
  activity: readonly ActivityEntry[];
  /** Drives the empty-state copy: waiting to connect reads differently from connected-but-idle. */
  connected: boolean;
}>();
</script>

<template>
  <TransitionGroup v-if="activity.length > 0" tag="ul" name="row" class="flex flex-col gap-px">
    <TabActivityRow v-for="entry in activity" :key="entry.id" :entry="entry" />
  </TransitionGroup>

  <!-- `flex-1`, not `h-full`: the scrolled panel this sits in is `min-h-full` so that a long list
       can grow past the viewport, and a percentage height resolves against nothing under a parent
       whose height is only a minimum. Filling the flex line centers this against the same box. -->
  <div v-else class="flex flex-1 flex-col items-center justify-center gap-1.5 px-6 text-center">
    <Radio class="mb-0.5 size-6 text-faint" />
    <p class="font-medium text-dim">
      {{ connected ? 'Connected and idle' : 'Waiting for the MCP client' }}
    </p>
    <p class="text-meta leading-relaxed text-dim">
      {{
        connected
          ? 'Tool calls from your agent will show up here.'
          : 'Start your agent — this panel connects automatically.'
      }}
    </p>
  </div>
</template>
