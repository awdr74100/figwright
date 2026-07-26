<script setup lang="ts">
import { Check, ChevronRight, Crosshair, X } from '@lucide/vue';
import { computed, ref } from 'vue';

import { useSharedNow } from '../composables/useSharedNow.js';
import { formatClockTime, formatRelativeTime } from '../lib/format.js';
import type { ActivityEntry, ActivityStatus } from '../relay/state.js';
import { revealOnCanvas } from '../sandbox/commands.js';
import UiPayloadBlock from './UiPayloadBlock.vue';

const props = defineProps<{ entry: ActivityEntry }>();

const STATUS_COLOR = {
  pending: 'text-warning',
  ok: 'text-success',
  error: 'text-danger',
} satisfies Record<ActivityStatus, string>;

/** A call slow enough to be worth noticing gets warm-toned rather than muted. */
const SLOW_CALL_MS = 2000;

const now = useSharedNow();

// Expansion is per-row state: the list keys rows by request id, so Vue reuses this component across
// updates and the open/closed state survives new calls arriving above it.
const expanded = ref(false);
/**
 * Openable as soon as there is anything to show — which is at dispatch, since the request snapshot
 * is recorded before the call is sent. Waiting for the result would withhold the arguments exactly
 * when they matter most: while a call is still running and you want to know what it was asked to
 * do.
 */
const expandable = computed(
  () => props.entry.request !== undefined || props.entry.payload !== undefined,
);

// Calls that named a node can jump the canvas to it; read-only queries usually can't.
const revealable = computed(() => (props.entry.nodeIds?.length ?? 0) > 0);
const reveal = (): void => revealOnCanvas(props.entry.nodeIds ?? []);

const durationTone = computed(() =>
  props.entry.durationMs !== undefined && props.entry.durationMs > SLOW_CALL_MS
    ? 'text-warning'
    : 'text-faint',
);
</script>

<template>
  <li>
    <!-- The row is a container, not a control: the expand toggle and the reveal button have to be
         siblings, since a button can't legally nest inside another one. -->
    <div
      class="group flex w-full items-center gap-2 rounded-md px-1.5 py-1 transition-colors duration-150"
      :class="expandable ? 'hover:bg-hover' : ''"
    >
      <component
        :is="expandable ? 'button' : 'div'"
        class="flex min-w-0 flex-1 items-center gap-2 text-left"
        @click="expandable && (expanded = !expanded)"
      >
        <span
          class="grid size-3 shrink-0 place-items-center"
          :class="[STATUS_COLOR[entry.status], entry.status === 'pending' ? 'animate-breathe' : '']"
        >
          <Check v-if="entry.status === 'ok'" class="size-3" />
          <X v-else-if="entry.status === 'error'" class="size-3" />
          <span v-else class="size-1.5 rounded-full bg-current" />
        </span>

        <span
          class="min-w-0 flex-1 truncate font-medium"
          :class="entry.status === 'error' ? 'text-danger' : 'text-fg'"
        >
          {{ entry.method }}
        </span>

        <span class="shrink-0 text-meta tabular-nums" :class="durationTone">
          {{ entry.durationMs === undefined ? '' : `${entry.durationMs}ms` }}
        </span>
        <!-- Relative age reads best at a glance; the exact clock time is there on hover for when
             you're lining the panel up against a log or a recording. -->
        <span
          class="w-7 shrink-0 text-right text-meta text-faint tabular-nums"
          :title="formatClockTime(entry.startedAt)"
        >
          {{ formatRelativeTime(entry.startedAt, now.getTime()) }}
        </span>
      </component>

      <!-- Reveal stays out of the way until the row is hovered — it's a secondary action, and the
           list is long. The slot is always present so the columns keep aligning. -->
      <span class="grid size-3 shrink-0 place-items-center">
        <button
          v-if="revealable"
          class="text-faint opacity-0 transition-opacity duration-150 group-hover:opacity-100 hover:text-fg focus-visible:opacity-100"
          :aria-label="`Reveal the nodes ${entry.method} touched`"
          title="Select and zoom to the nodes this call touched"
          @click="reveal"
        >
          <Crosshair class="size-3" />
        </button>
      </span>

      <span class="grid size-3 shrink-0 place-items-center text-faint">
        <ChevronRight
          v-if="expandable"
          class="size-3 transition-transform duration-200 ease-standard"
          :class="expanded ? 'rotate-90' : ''"
        />
      </span>
    </div>

    <!-- 0fr → 1fr animates to the content's natural height without measuring it in JS — which is
         also what lets the result block slide in later, under an already-open row. -->
    <div
      v-if="expandable"
      class="grid transition-[grid-template-rows] duration-240 ease-out-expo"
      :class="expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'"
    >
      <div class="overflow-hidden">
        <div class="mt-1 mb-2 ml-3.5 space-y-2.5 border-l border-line pl-2.5">
          <!-- The row shows a relative age because that reads best at a glance; the wall clock
               belongs here, where you've opened a specific call to reconcile it against a log or a
               recording. -->
          <p class="font-mono text-meta text-faint">
            Started {{ formatClockTime(entry.startedAt) }}
          </p>

          <UiPayloadBlock
            v-if="entry.request"
            label="Request"
            :preview="entry.request.preview"
            max-height="max-h-40"
          />
          <!-- Absent while the call is in flight. Its absence is the signal — the row's breathing
               dot and empty duration already say "running", so a placeholder here would only add a
               second layout shift when the real block arrives. -->
          <UiPayloadBlock
            v-if="entry.payload"
            label="Payload → LLM"
            :preview="entry.payload.preview"
            :bytes="entry.payload.bytes"
            :truncated="entry.payload.truncated"
          />
        </div>
      </div>
    </div>
  </li>
</template>
