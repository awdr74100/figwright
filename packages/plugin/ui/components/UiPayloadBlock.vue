<script setup lang="ts">
import { formatSize } from '../lib/format.js';
import UiCopyButton from './UiCopyButton.vue';
import UiSectionHeading from './UiSectionHeading.vue';

defineProps<{
  label: string;
  preview: string;
  /** Omitted for the request block, which has no size to report. */
  bytes?: number;
  truncated?: boolean;
  /** Cap on the `<pre>` height; requests are shorter than results. */
  maxHeight?: string;
}>();
</script>

<!-- A captured JSON payload, rendered as it crossed the boundary: heading, its real size, and a
     copy of the exact text. -->
<template>
  <div>
    <div class="mb-1 flex items-center gap-2">
      <UiSectionHeading class="min-w-0 truncate">{{ label }}</UiSectionHeading>
      <span v-if="bytes !== undefined" class="shrink-0 text-meta text-faint tabular-nums">
        {{ formatSize(bytes) }}
      </span>
      <UiCopyButton class="ml-auto" label="Copy" :value="preview" compact />
    </div>

    <pre
      class="overflow-auto rounded-md bg-raised p-2 font-mono text-meta leading-snug"
      :class="maxHeight ?? 'max-h-64'"
      >{{ preview }}</pre>

    <p v-if="truncated" class="mt-1 text-meta text-dim">
      Showing the first part only — the full result was larger.
    </p>
  </div>
</template>
