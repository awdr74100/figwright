<script setup lang="ts">
import { isPluginContextEvent, type PluginContextEvent, portRange } from '@figma-mcp-relay/shared';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

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
  idle: 'bg-relay-muted',
  connecting: 'bg-yellow-400',
  connected: 'bg-relay-accent',
  reconnecting: 'bg-yellow-400',
  disconnected: 'bg-relay-danger',
} satisfies Record<RelayStatus, string>;

const statusGlyph = { pending: '·', ok: '✓', error: '✕' } satisfies Record<ActivityStatus, string>;
const statusColor = {
  pending: 'text-yellow-400',
  ok: 'text-relay-accent',
  error: 'text-relay-danger',
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
const now = ref(Date.now());

const shortId = `${client.sessionId.slice(0, 8)}…`;
const errorEntries = computed(() => state.value.activity.filter(e => e.status === 'error'));

const formatAgo = (ts: number): string => {
  const s = Math.max(0, Math.round((now.value - ts) / 1000));
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

let unsubscribe: (() => void) | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;

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
  if (document.visibilityState !== 'visible') return;
  client.notifyActivity({ fileName: c.fileName, pageId: c.pageId, pageName: c.pageName });
};

const onWindowMessage = (event: MessageEvent): void => {
  const msg = (event.data as { pluginMessage?: unknown } | null)?.pluginMessage;
  if (isPluginContextEvent(msg)) {
    context.value = msg;
    // Each context push from sandbox means the user just interacted (open / selection-change /
    // page-change). Tell the leader — params carry file/page identity so ping can report which
    // file is being routed instead of an opaque session id.
    emitActivity();
  }
};

// When this tab becomes the foreground (visibilitychange → visible), re-assert activity so routing
// follows the file the user switched to — even with no canvas click. We deliberately do NOT listen on
// window `focus`: that fires on EVERY tab when the user returns to the Figma app (it's not per-tab),
// which is exactly the broadcast that made background files steal routing. `visibilitychange` only
// fires on the tab whose visibility actually changed, and emitActivity's `visible` gate ensures the
// background side (going → hidden) stays silent.
const onVisibility = (): void => emitActivity();

onMounted(() => {
  unsubscribe = client.subscribe(s => {
    state.value = s;
  });
  ticker = setInterval(() => {
    now.value = Date.now();
  }, 1000);
  globalThis.addEventListener('message', onWindowMessage);
  document.addEventListener('visibilitychange', onVisibility);
  client.connect().catch(err => console.warn('[relay-client] initial connect failed:', err));
});

onBeforeUnmount(() => {
  unsubscribe?.();
  if (ticker !== null) clearInterval(ticker);
  globalThis.removeEventListener('message', onWindowMessage);
  document.removeEventListener('visibilitychange', onVisibility);
  bridge.dispose();
  client.disconnect().catch(() => {});
});
</script>

<template>
  <main class="flex h-full flex-col bg-relay-bg text-relay-fg text-xs">
    <header class="flex items-center gap-2 border-b border-white/10 px-3 py-2">
      <span :class="['inline-block size-2 shrink-0 rounded-full', dotClass[state.status]]" />
      <span class="font-medium">{{ statusLabel[state.status] }}</span>
      <span class="ml-auto truncate font-mono text-relay-muted">{{ headerMeta }}</span>
    </header>

    <nav class="flex border-b border-white/10">
      <button
        v-for="[id, label] in tabs"
        :key="id"
        class="flex-1 px-2 py-1.5 text-center"
        :class="
          tab === id
            ? 'border-b-2 border-relay-accent text-relay-fg'
            : 'text-relay-muted hover:text-relay-fg'
        "
        @click="tab = id"
      >
        {{ label }}
      </button>
    </nav>

    <section class="flex-1 overflow-y-auto p-3">
      <!-- Activity -->
      <template v-if="tab === 'activity'">
        <ul v-if="state.activity.length > 0" class="space-y-0.5 font-mono">
          <li v-for="e in state.activity" :key="e.id" class="flex items-center gap-2">
            <span :class="statusColor[e.status]">{{ statusGlyph[e.status] }}</span>
            <span class="truncate" :class="e.status === 'error' ? 'text-relay-danger' : ''">
              {{ e.method }}
            </span>
            <span class="ml-auto shrink-0 text-relay-muted">
              {{ e.durationMs === undefined ? '' : `${e.durationMs}ms` }}
            </span>
            <span class="w-9 shrink-0 text-right text-relay-muted">{{
              formatAgo(e.startedAt)
            }}</span>
          </li>
        </ul>
        <p v-else class="text-relay-muted">No activity yet — waiting for Claude…</p>
      </template>

      <!-- Context -->
      <template v-else-if="tab === 'context'">
        <div v-if="context !== null" class="space-y-3">
          <dl class="space-y-1.5">
            <div class="flex justify-between gap-2">
              <dt class="shrink-0 text-relay-muted">File</dt>
              <dd class="truncate text-right">{{ context.fileName }}</dd>
            </div>
            <div class="flex justify-between gap-2">
              <dt class="shrink-0 text-relay-muted">Page</dt>
              <dd class="truncate text-right">{{ context.pageName }}</dd>
            </div>
            <div class="flex justify-between gap-2">
              <dt class="shrink-0 text-relay-muted">Editor</dt>
              <dd class="text-right font-mono">
                {{ context.editorType }} · API {{ context.apiVersion }}
              </dd>
            </div>
          </dl>
          <div>
            <p class="mb-1 text-relay-muted">Selection ({{ context.selectionCount }})</p>
            <ul v-if="context.selection.length > 0" class="space-y-1 font-mono">
              <li v-for="n in context.selection" :key="n.id" class="flex items-center gap-2">
                <span class="truncate">{{ n.name }}</span>
                <span class="ml-auto shrink-0 text-relay-muted">{{ n.type }}</span>
                <span class="w-14 shrink-0 text-right text-relay-muted"
                  >{{ n.width }}×{{ n.height }}</span
                >
              </li>
              <li v-if="context.selectionCount > context.selection.length" class="text-relay-muted">
                …and {{ context.selectionCount - context.selection.length }} more
              </li>
            </ul>
            <p v-else class="text-relay-muted">Nothing selected</p>
          </div>
        </div>
        <p v-else class="text-relay-muted">Waiting for plugin context…</p>
      </template>

      <!-- Debug -->
      <template v-else>
        <div class="space-y-3">
          <div>
            <p class="mb-1 text-relay-muted">Connection</p>
            <div class="space-y-0.5 font-mono">
              <div>session · {{ shortId }}{{ state.sessionResumed ? ' (resumed)' : '' }}</div>
              <div>reconnects · {{ state.reconnectCount }}</div>
              <div v-if="state.lastError !== null" class="wrap-break-word text-relay-danger">
                last error · {{ state.lastError }}
              </div>
            </div>
          </div>
          <div>
            <p class="mb-1 text-relay-muted">Recent errors</p>
            <ul v-if="errorEntries.length > 0" class="space-y-1.5 font-mono">
              <li v-for="e in errorEntries" :key="e.id">
                <div class="flex justify-between gap-2">
                  <span class="truncate text-relay-danger">{{ e.method }}</span>
                  <span class="shrink-0 text-relay-muted">{{ formatAgo(e.startedAt) }}</span>
                </div>
                <div class="wrap-break-word text-relay-muted">{{ e.error }}</div>
              </li>
            </ul>
            <p v-else class="text-relay-muted">No errors.</p>
          </div>
        </div>
      </template>
    </section>

    <footer class="border-t border-white/10 px-3 py-1.5 text-[10px] text-relay-muted">
      figma-mcp-relay v0.0.0 · {{ state.totalCalls }} calls
    </footer>
  </main>
</template>
