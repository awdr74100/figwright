<script setup lang="ts">
import { computed } from 'vue';

import { useSharedNow } from '../composables/useSharedNow.js';
import { formatRelativeTime } from '../lib/format.js';
import type { RelayStatus } from '../relay/state.js';

const props = defineProps<{
  status: RelayStatus;
  port: number | null;
  connectedAt: number | null;
}>();

const STATUS_LABEL = {
  idle: 'Idle',
  connecting: 'Connecting',
  connected: 'Connected',
  reconnecting: 'Reconnecting',
  disconnected: 'Disconnected',
} satisfies Record<RelayStatus, string>;

// The dot is `bg-current`, so a text color drives both the fill and its glow.
const STATUS_TONE = {
  idle: 'text-faint',
  connecting: 'text-warning',
  connected: 'text-success',
  reconnecting: 'text-warning',
  disconnected: 'text-danger',
} satisfies Record<RelayStatus, string>;

const now = useSharedNow();

// A connection that is still settling gets a pulsing ring; a live one gets a steady glow.
const settling = computed(() => props.status === 'connecting' || props.status === 'reconnecting');

const meta = computed(() => {
  if (props.status !== 'connected') return '';
  const port = props.port === null ? '' : `:${props.port}`;
  const up =
    props.connectedAt === null
      ? ''
      : ` · up ${formatRelativeTime(props.connectedAt, now.value.getTime())}`;
  return `${port}${up}`;
});
</script>

<template>
  <div class="flex items-center gap-2.5">
    <span class="relative flex size-2 shrink-0" :class="STATUS_TONE[status]">
      <span v-if="settling" class="absolute inset-0 animate-ping-ring rounded-full bg-current" />
      <span
        class="relative size-2 rounded-full bg-current"
        :class="status === 'connected' ? 'shadow-[0_0_7px_currentColor]' : ''"
      />
    </span>
    <span class="font-medium tracking-tight text-fg">{{ STATUS_LABEL[status] }}</span>
    <span class="ml-auto min-w-0 truncate text-meta text-faint tabular-nums">{{ meta }}</span>
  </div>
</template>
