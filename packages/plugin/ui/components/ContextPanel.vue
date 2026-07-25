<script setup lang="ts">
import type { PluginContextEvent } from '@figwright/shared';
import { computed } from 'vue';

import SectionHeading from './SectionHeading.vue';

const props = defineProps<{ context: PluginContextEvent | null }>();

// Nodes the sandbox didn't serialize (it caps the detail count) — surfaced as an "…and N more" line.
const hiddenCount = computed(() =>
  props.context === null ? 0 : props.context.selectionCount - props.context.selection.length,
);
</script>

<template>
  <div v-if="context !== null" class="space-y-3 px-1.5">
    <dl class="space-y-1.5">
      <div class="flex items-baseline justify-between gap-3">
        <dt class="shrink-0 text-dim">File</dt>
        <dd class="min-w-0 truncate text-right font-medium">{{ context.fileName }}</dd>
      </div>
      <div class="flex items-baseline justify-between gap-3">
        <dt class="shrink-0 text-dim">Page</dt>
        <dd class="min-w-0 truncate text-right font-medium">{{ context.pageName }}</dd>
      </div>
      <div class="flex items-baseline justify-between gap-3">
        <dt class="shrink-0 text-dim">Editor</dt>
        <dd class="text-right font-mono text-[10px] text-dim">
          {{ context.editorType }} · API {{ context.apiVersion }}
        </dd>
      </div>
    </dl>

    <div class="border-t border-line pt-2.5">
      <SectionHeading class="mb-1.5">Selection ({{ context.selectionCount }})</SectionHeading>
      <ul v-if="context.selection.length > 0" class="space-y-0.5">
        <li
          v-for="node in context.selection"
          :key="node.id"
          class="flex items-center gap-2 rounded px-1 py-0.5 transition-colors duration-150 hover:bg-hover"
        >
          <span class="min-w-0 flex-1 truncate">{{ node.name }}</span>
          <span class="shrink-0 rounded bg-raised px-1 py-px font-mono text-[9px] text-dim">
            {{ node.type }}
          </span>
          <span class="shrink-0 tabular-nums text-[10px] text-faint">
            {{ node.width }}×{{ node.height }}
          </span>
        </li>
        <li v-if="hiddenCount > 0" class="px-1 text-dim">…and {{ hiddenCount }} more</li>
      </ul>
      <p v-else class="px-1 text-dim">Nothing selected</p>
    </div>
  </div>
  <p v-else class="px-1.5 text-dim">Waiting for plugin context…</p>
</template>
