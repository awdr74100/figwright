<script setup lang="ts">
import { computed } from 'vue';

import type { PluginContextEvent } from '../../protocol/bridge.js';
import UiMetaRow from './UiMetaRow.vue';
import UiSection from './UiSection.vue';

const props = defineProps<{ context: PluginContextEvent | null }>();

// Nodes the sandbox didn't serialize (it caps the detail count) — surfaced as an "…and N more" line.
const hiddenCount = computed(() =>
  props.context === null ? 0 : props.context.selectionCount - props.context.selection.length,
);
</script>

<template>
  <div v-if="context !== null" class="divide-y divide-line px-1.5">
    <UiSection>
      <dl class="space-y-1.5">
        <UiMetaRow label="File" truncate value-class="font-medium">
          {{ context.fileName }}
        </UiMetaRow>
        <UiMetaRow label="Page" truncate value-class="font-medium">
          {{ context.pageName }}
        </UiMetaRow>
        <UiMetaRow label="Editor" mono value-class="text-dim">
          {{ context.editorType }} · API {{ context.apiVersion }}
        </UiMetaRow>
      </dl>
    </UiSection>

    <UiSection :title="`Selection (${context.selectionCount})`">
      <ul v-if="context.selection.length > 0" class="space-y-0.5">
        <li
          v-for="node in context.selection"
          :key="node.id"
          class="flex items-center gap-2 rounded px-1 py-0.5 transition-colors duration-150 hover:bg-hover"
        >
          <span class="min-w-0 flex-1 truncate">{{ node.name }}</span>
          <span class="shrink-0 rounded bg-raised px-1 py-px font-mono text-chip text-dim">
            {{ node.type }}
          </span>
          <span class="shrink-0 text-meta text-faint tabular-nums">
            {{ node.width }}×{{ node.height }}
          </span>
        </li>
        <li v-if="hiddenCount > 0" class="px-1 text-dim">…and {{ hiddenCount }} more</li>
      </ul>
      <p v-else class="px-1 text-dim">Nothing selected</p>
    </UiSection>
  </div>
  <p v-else class="px-1.5 text-dim">Waiting for plugin context…</p>
</template>
