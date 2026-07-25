<script setup lang="ts">
import { useCopyToClipboard } from '../composables/useCopyToClipboard.js';
import { formatSize } from '../lib/format.js';
import SectionHeading from './SectionHeading.vue';

defineProps<{
  label: string;
  preview: string;
  /** Omitted for the request block, which has no size to report. */
  bytes?: number;
  truncated?: boolean;
  /** Cap on the <pre> height; requests are shorter than results. */
  maxHeight?: string;
}>();

// Each PayloadPreview owns its own `copied` flag, so only the block that was actually copied flashes.
const { copy, copied } = useCopyToClipboard();
</script>

<template>
  <div>
    <div class="mb-1 flex items-center gap-2">
      <SectionHeading class="min-w-0 truncate">{{ label }}</SectionHeading>
      <span v-if="bytes !== undefined" class="shrink-0 tabular-nums text-[10px] text-faint">
        {{ formatSize(bytes) }}
      </span>
      <button
        class="ml-auto shrink-0 rounded border border-line px-1.5 py-0.5 text-[10px] transition-colors duration-150 hover:border-line-strong hover:bg-hover"
        :class="copied ? 'text-success' : 'text-dim'"
        @click.stop="copy(preview)"
      >
        {{ copied ? 'Copied' : 'Copy' }}
      </button>
    </div>

    <pre
      class="overflow-auto rounded-md bg-raised p-2 font-mono text-[10px] leading-snug"
      :class="maxHeight ?? 'max-h-64'"
      >{{ preview }}</pre>

    <p v-if="truncated" class="mt-1 text-[10px] text-dim">
      Showing the first part only — the full result was larger.
    </p>
  </div>
</template>
