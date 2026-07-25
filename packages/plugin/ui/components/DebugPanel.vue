<script setup lang="ts">
import { computed } from 'vue';

import { useCopyToClipboard } from '../composables/useCopyToClipboard.js';
import { useSharedNow } from '../composables/useSharedNow.js';
import { formatClockTime, formatRelativeTime } from '../lib/format.js';
import type { RelayClientState } from '../relay/client.js';
import SectionHeading from './SectionHeading.vue';

const props = defineProps<{
  state: RelayClientState;
  sessionId: string;
  /** Shown next to the server's, so a version skew between the two is visible in one place. */
  pluginVersion: string;
  /** Built lazily — the bundle embeds every recorded call, so only serialize on click. */
  buildDiagnostics: () => string;
}>();

const now = useSharedNow();
const shortId = computed(() => `${props.sessionId.slice(0, 8)}…`);
const errorEntries = computed(() => props.state.activity.filter(e => e.status === 'error'));

/**
 * Mean duration of the calls still in the recent list. Unlike the totals, this can only be measured
 * over what's retained (ACTIVITY_LIMIT), which is why it's labelled as recent — it's a health
 * signal, not an accounting figure. Pending calls have no duration yet and are left out.
 */
const averageMs = computed(() => {
  const settled = props.state.activity.filter(e => e.durationMs !== undefined);
  if (settled.length === 0) return null;
  const total = settled.reduce((sum, e) => sum + (e.durationMs ?? 0), 0);
  return Math.round(total / settled.length);
});

const { copy, copied } = useCopyToClipboard();
</script>

<template>
  <div class="space-y-3.5 px-1.5">
    <div>
      <SectionHeading class="mb-1.5">Connection</SectionHeading>
      <dl class="space-y-1">
        <div class="flex items-baseline justify-between gap-3">
          <dt class="text-dim">Session</dt>
          <dd class="font-mono text-[10px]">
            {{ shortId }}{{ state.sessionResumed ? ' (resumed)' : '' }}
          </dd>
        </div>
        <div class="flex items-baseline justify-between gap-3">
          <dt class="text-dim">Reconnects</dt>
          <dd class="font-mono text-[10px] tabular-nums">{{ state.reconnectCount }}</dd>
        </div>
        <div class="flex items-baseline justify-between gap-3">
          <dt class="text-dim">Plugin</dt>
          <dd class="font-mono text-[10px]">v{{ pluginVersion }}</dd>
        </div>
        <div v-if="state.serverVersion !== null" class="flex items-baseline justify-between gap-3">
          <dt class="text-dim">Server</dt>
          <dd class="font-mono text-[10px]">v{{ state.serverVersion }}</dd>
        </div>
      </dl>
      <p
        v-if="state.lastError !== null"
        class="mt-1.5 rounded-md bg-raised p-1.5 font-mono text-[10px] wrap-break-word text-danger"
      >
        {{ state.lastError }}
      </p>
    </div>

    <div class="border-t border-line pt-2.5">
      <SectionHeading class="mb-1.5">Calls</SectionHeading>
      <dl class="space-y-1">
        <div class="flex items-baseline justify-between gap-3">
          <dt class="text-dim">Total</dt>
          <dd class="font-mono text-[10px] tabular-nums">{{ state.totalCalls }}</dd>
        </div>
        <div class="flex items-baseline justify-between gap-3">
          <dt class="text-dim">Failed</dt>
          <dd
            class="font-mono text-[10px] tabular-nums"
            :class="state.failedCalls > 0 ? 'text-danger' : ''"
          >
            {{ state.failedCalls }}
          </dd>
        </div>
        <div v-if="averageMs !== null" class="flex items-baseline justify-between gap-3">
          <dt class="text-dim">Avg (recent)</dt>
          <dd class="font-mono text-[10px] tabular-nums">{{ averageMs }}ms</dd>
        </div>
      </dl>
    </div>

    <div class="border-t border-line pt-2.5">
      <SectionHeading class="mb-1.5">Recent errors</SectionHeading>
      <ul v-if="errorEntries.length > 0" class="space-y-1.5">
        <li v-for="entry in errorEntries" :key="entry.id" class="rounded-md bg-raised p-1.5">
          <div class="flex items-baseline justify-between gap-2">
            <span class="min-w-0 truncate font-medium text-danger">{{ entry.method }}</span>
            <span
              class="shrink-0 tabular-nums text-[10px] text-faint"
              :title="formatClockTime(entry.startedAt)"
            >
              {{ formatRelativeTime(entry.startedAt, now.getTime()) }}
            </span>
          </div>
          <div class="mt-0.5 font-mono text-[10px] leading-snug wrap-break-word text-dim">
            {{ entry.error }}
          </div>
        </li>
      </ul>
      <p v-else class="text-dim">No errors.</p>
    </div>

    <div class="border-t border-line pt-2.5">
      <SectionHeading class="mb-1.5">Diagnostics</SectionHeading>
      <button
        class="rounded-md border border-line px-2 py-1 transition-colors duration-150 hover:border-line-strong hover:bg-hover disabled:opacity-40 disabled:hover:bg-transparent"
        :class="copied ? 'text-success' : 'text-dim'"
        :disabled="state.activity.length === 0"
        @click="copy(buildDiagnostics())"
      >
        {{ copied ? 'Copied' : 'Copy diagnostic bundle' }}
      </button>
      <p class="mt-1.5 text-[10px] leading-relaxed text-dim">
        For bug reports · includes your design content.
      </p>
    </div>
  </div>
</template>
