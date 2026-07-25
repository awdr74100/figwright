<script setup lang="ts">
defineProps<{
  label: string;
  /**
   * Monospace, at meta size, with tabular figures — for values you read as data rather than as
   * prose: ids, versions, counts, durations. Digits line up column-wise, so a number that changes
   * doesn't make the row twitch.
   */
  mono?: boolean;
  /**
   * Cut the value off rather than let it push the row wide. Only for values that can run
   * arbitrarily long — a file or page name the user chose. A version or an id is short and its tail
   * matters, so those are left whole.
   */
  truncate?: boolean;
  /** Extra classes for the value itself; the fallthrough class lands on the row, not on the `dd`. */
  valueClass?: string;
}>();
</script>

<!--
  One `label — value` line inside a `<dl>`. The panel is largely made of these, and every one of
  them wants the same thing: the label pinned left at a muted weight, the value right-aligned.
-->
<template>
  <div class="flex items-baseline justify-between gap-3">
    <dt class="shrink-0 text-dim">{{ label }}</dt>
    <dd
      class="text-right"
      :class="[
        truncate ? 'min-w-0 truncate' : '',
        mono ? 'font-mono text-meta tabular-nums' : '',
        valueClass,
      ]"
    >
      <slot />
    </dd>
  </div>
</template>
