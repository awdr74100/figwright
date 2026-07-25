<script setup lang="ts">
import { useCopyToClipboard } from '../composables/useCopyToClipboard.js';

const props = defineProps<{
  /** Button text before a copy; it becomes "Copied" for ~1.5s afterwards. */
  label: string;
  /**
   * What lands on the clipboard. Pass a function when producing the text is expensive — the
   * diagnostic bundle serializes every recorded call — and it will only run on click.
   */
  value: string | (() => string);
  disabled?: boolean;
  /** Tighter geometry, for sitting inline in a block's header row rather than standing alone. */
  compact?: boolean;
}>();

// Each button owns its own `copied` flag, so only the one that was actually clicked flashes.
const { copy, copied } = useCopyToClipboard();

const onClick = (): void => {
  void copy(typeof props.value === 'function' ? props.value() : props.value);
};
</script>

<!--
  `@click.stop` unconditionally: these sit inside rows that are themselves toggle buttons, and
  copying must never also expand or collapse what you were reading.
-->
<template>
  <button
    class="shrink-0 border border-line transition-colors duration-150 hover:border-line-strong hover:bg-hover disabled:opacity-40 disabled:hover:border-line disabled:hover:bg-transparent"
    :class="[
      compact ? 'rounded px-1.5 py-0.5 text-meta' : 'rounded-md px-2 py-1',
      copied ? 'text-success' : 'text-dim',
    ]"
    :disabled="disabled"
    @click.stop="onClick"
  >
    {{ copied ? 'Copied' : label }}
  </button>
</template>
