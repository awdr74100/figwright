<script setup lang="ts">
import { isPluginContextEvent, type PluginContextEvent, portRange } from '@figwright/shared';
import { tryOnScopeDispose, useDocumentVisibility, useEventListener, useNow } from '@vueuse/core';
import { computed, onMounted, ref, watch } from 'vue';

import { createSandboxBridge } from './bridge/sandbox.js';
import {
  type ActivityStatus,
  RelayClient,
  type RelayClientState,
  type RelayStatus,
} from './relay/client.js';

type Tab = 'activity' | 'context' | 'debug';
const tabs = [
  ['activity', 'Activity'],
  ['context', 'Context'],
  ['debug', 'Debug'],
] satisfies ReadonlyArray<readonly [Tab, string]>;

const statusLabel = {
  idle: 'Idle',
  connecting: 'Connecting…',
  connected: 'Connected',
  reconnecting: 'Reconnecting…',
  disconnected: 'Disconnected',
} satisfies Record<RelayStatus, string>;

const dotClass = {
  idle: 'bg-fig-muted',
  connecting: 'bg-yellow-400',
  connected: 'bg-fig-accent',
  reconnecting: 'bg-yellow-400',
  disconnected: 'bg-fig-danger',
} satisfies Record<RelayStatus, string>;

const statusGlyph = { pending: '·', ok: '✓', error: '✕' } satisfies Record<ActivityStatus, string>;
const statusColor = {
  pending: 'text-yellow-400',
  ok: 'text-fig-accent',
  error: 'text-fig-danger',
} satisfies Record<ActivityStatus, string>;

const client = new RelayClient({
  ports: portRange(),
  clientVersion: '0.0.0',
  log: msg => console.log(msg),
});
const bridge = createSandboxBridge({ log: msg => console.log(msg) });
client.setToolHandler(bridge.handler);

const tab = ref<Tab>('activity');
const state = ref<RelayClientState>(client.getState());
const context = ref<PluginContextEvent | null>(null);
const now = useNow({ interval: 1000 });
const visibility = useDocumentVisibility();

const shortId = `${client.sessionId.slice(0, 8)}…`;
const errorEntries = computed(() => state.value.activity.filter(e => e.status === 'error'));

const formatAgo = (ts: number): string => {
  const s = Math.max(0, Math.round((now.value.getTime() - ts) / 1000));
  if (s < 1) return 'now';
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h`;
};

const headerMeta = computed(() => {
  if (state.value.status !== 'connected') return '';
  const port = state.value.port === null ? '' : `:${state.value.port}`;
  const up = state.value.connectedAt === null ? '' : ` · up ${formatAgo(state.value.connectedAt)}`;
  return `${port}${up}`;
});

// Re-assert this session's activity from the latest known context. The leader routes to the
// most-recently-active session, so emitting bumps this plugin to the front. No-op until the sandbox
// has pushed at least one context (file/page identity is required by ActivityParams).
const emitActivity = (): void => {
  const c = context.value;
  if (c === null) return;
  // Only the foreground tab reports `visible`; background tabs are `hidden` (verified empirically on
  // Figma desktop). Gating activity on visibility means only the file the user is actually looking at
  // ever claims routing — so switching tabs auto-follows the foreground file, and a background tab can
  // never steal routing via a broadcast focus/visibility event. This is the core of selection/visibility
  // -driven routing. See [[project-routing-stability-backlog]].
  if (visibility.value !== 'visible') return;
  client.notifyActivity({ fileName: c.fileName, pageId: c.pageId, pageName: c.pageName });
};

useEventListener(globalThis, 'message', (event: MessageEvent) => {
  const msg = (event.data as { pluginMessage?: unknown } | null)?.pluginMessage;
  if (isPluginContextEvent(msg)) {
    context.value = msg;
    // Each context push from sandbox means the user just interacted (open / selection-change /
    // page-change). Tell the leader — params carry file/page identity so ping can report which
    // file is being routed instead of an opaque session id.
    emitActivity();
  }
});

// When this tab becomes the foreground (visibility → 'visible'), re-assert activity so routing follows
// the file the user switched to — even with no canvas click. `useDocumentVisibility` is backed solely by
// the `visibilitychange` event, which only fires on the tab whose visibility actually changed. We
// deliberately do NOT react to window `focus`: that fires on EVERY tab when the user returns to the Figma
// app (it's not per-tab), which is exactly the broadcast that made background files steal routing.
// emitActivity's `visible` gate keeps the background side (going → hidden) silent.
watch(visibility, v => {
  if (v === 'visible') emitActivity();
});

// Mirror the relay client's state into a ref — subscribe synchronously so the panel reflects the
// initial state, then tear everything down when the component's reactive scope is disposed.
const stopSubscribe = client.subscribe(s => {
  state.value = s;
});
tryOnScopeDispose(() => {
  stopSubscribe();
  bridge.dispose();
  client.disconnect().catch(() => {});
});

onMounted(() => {
  client.connect().catch(err => console.warn('[relay-client] initial connect failed:', err));
});

// Hide the panel into the background. The relay socket lives in this iframe, so we ask the sandbox to
// figma.ui.hide() (keeps the connection alive) rather than closing the plugin.
const runInBackground = (): void => {
  (globalThis as { parent?: { postMessage: (m: unknown, t: string) => void } }).parent?.postMessage(
    { pluginMessage: { type: 'ui:minimize' } },
    '*',
  );
};
</script>

<template>
  <main class="flex h-full flex-col bg-fig-bg text-fig-fg text-xs">
    <header class="flex items-center gap-2 border-b border-white/10 px-2.5 py-1.5">
      <span :class="['inline-block size-2 shrink-0 rounded-full', dotClass[state.status]]" />
      <span class="font-medium">{{ statusLabel[state.status] }}</span>
      <span class="ml-auto truncate font-mono text-[11px] text-fig-muted">{{ headerMeta }}</span>
    </header>

    <nav class="flex gap-1 border-b border-white/10 px-2 py-1">
      <button
        v-for="[id, label] in tabs"
        :key="id"
        class="rounded px-2 py-0.5 text-[11px] transition-colors"
        :class="tab === id ? 'bg-white/10 text-fig-fg' : 'text-fig-muted hover:text-fig-fg'"
        @click="tab = id"
      >
        {{ label }}
      </button>
    </nav>

    <section class="flex-1 overflow-y-auto overflow-x-hidden p-2.5">
      <!-- Activity -->
      <template v-if="tab === 'activity'">
        <ul v-if="state.activity.length > 0" class="space-y-0.5 font-mono">
          <li v-for="e in state.activity" :key="e.id" class="flex items-center gap-2">
            <span :class="statusColor[e.status]">{{ statusGlyph[e.status] }}</span>
            <span class="min-w-0 truncate" :class="e.status === 'error' ? 'text-fig-danger' : ''">
              {{ e.method }}
            </span>
            <span class="ml-auto shrink-0 text-fig-muted">
              {{ e.durationMs === undefined ? '' : `${e.durationMs}ms` }}
            </span>
            <span class="w-9 shrink-0 text-right text-fig-muted">{{ formatAgo(e.startedAt) }}</span>
          </li>
        </ul>
        <p v-else class="text-fig-muted">No activity yet — waiting for an MCP client…</p>
      </template>

      <!-- Context -->
      <template v-else-if="tab === 'context'">
        <div v-if="context !== null" class="space-y-3">
          <dl class="space-y-1.5">
            <div class="flex justify-between gap-2">
              <dt class="shrink-0 text-fig-muted">File</dt>
              <dd class="min-w-0 truncate text-right">{{ context.fileName }}</dd>
            </div>
            <div class="flex justify-between gap-2">
              <dt class="shrink-0 text-fig-muted">Page</dt>
              <dd class="min-w-0 truncate text-right">{{ context.pageName }}</dd>
            </div>
            <div class="flex justify-between gap-2">
              <dt class="shrink-0 text-fig-muted">Editor</dt>
              <dd class="text-right font-mono">
                {{ context.editorType }} · API {{ context.apiVersion }}
              </dd>
            </div>
          </dl>
          <div>
            <p class="mb-1 text-fig-muted">Selection ({{ context.selectionCount }})</p>
            <ul v-if="context.selection.length > 0" class="space-y-1 font-mono">
              <li v-for="n in context.selection" :key="n.id" class="flex items-center gap-2">
                <span class="min-w-0 truncate">{{ n.name }}</span>
                <span class="ml-auto shrink-0 text-fig-muted">{{ n.type }}</span>
                <span class="shrink-0 text-right tabular-nums text-fig-muted"
                  >{{ n.width }}×{{ n.height }}</span
                >
              </li>
              <li v-if="context.selectionCount > context.selection.length" class="text-fig-muted">
                …and {{ context.selectionCount - context.selection.length }} more
              </li>
            </ul>
            <p v-else class="text-fig-muted">Nothing selected</p>
          </div>
        </div>
        <p v-else class="text-fig-muted">Waiting for plugin context…</p>
      </template>

      <!-- Debug -->
      <template v-else>
        <div class="space-y-3">
          <div>
            <p class="mb-1 text-fig-muted">Connection</p>
            <div class="space-y-0.5 font-mono">
              <div>session · {{ shortId }}{{ state.sessionResumed ? ' (resumed)' : '' }}</div>
              <div>reconnects · {{ state.reconnectCount }}</div>
              <div v-if="state.lastError !== null" class="wrap-break-word text-fig-danger">
                last error · {{ state.lastError }}
              </div>
            </div>
          </div>
          <div>
            <p class="mb-1 text-fig-muted">Recent errors</p>
            <ul v-if="errorEntries.length > 0" class="space-y-1.5 font-mono">
              <li v-for="e in errorEntries" :key="e.id">
                <div class="flex justify-between gap-2">
                  <span class="min-w-0 truncate text-fig-danger">{{ e.method }}</span>
                  <span class="shrink-0 text-fig-muted">{{ formatAgo(e.startedAt) }}</span>
                </div>
                <div class="wrap-break-word text-fig-muted">{{ e.error }}</div>
              </li>
            </ul>
            <p v-else class="text-fig-muted">No errors.</p>
          </div>
        </div>
      </template>
    </section>

    <footer
      class="flex items-center gap-2 border-t border-white/10 px-3 py-1.5 text-[10px] text-fig-muted"
    >
      <span class="truncate">Figwright v0.0.0 · {{ state.totalCalls }} calls</span>
      <button
        class="ml-auto shrink-0 rounded border border-white/15 px-1.5 py-0.5 text-fig-muted hover:bg-white/10 hover:text-fig-fg"
        title="Run in background — hides the panel; the relay stays connected. Reopen by running the plugin again."
        @click="runInBackground"
      >
        Run in background
      </button>
    </footer>
  </main>
</template>
