<script setup lang="ts">
import {
  isPluginContextEvent,
  type PluginContextEvent,
  portRange,
  PROTOCOL_VERSION,
} from '@figwright/shared';
import {
  tryOnScopeDispose,
  useClipboard,
  useDocumentVisibility,
  useEventListener,
  useNow,
} from '@vueuse/core';
import { computed, onMounted, ref, watch } from 'vue';

import { createSandboxBridge } from './bridge/sandbox.js';
import {
  type ActivityStatus,
  RelayClient,
  type RelayClientState,
  type RelayStatus,
} from './relay/client.js';
import { buildDiagnosticBundle } from './relay/diagnostics.js';

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

const appVersion = __APP_VERSION__;

const client = new RelayClient({
  ports: portRange(),
  clientVersion: appVersion,
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

// Which Activity rows are expanded to show the payload fed to the LLM, and which just got copied.
const expanded = ref<Set<string>>(new Set());

const toggle = (id: string): void => {
  const next = new Set(expanded.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expanded.value = next;
};

const formatSize = (bytes: number): string =>
  bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;

// Copy the shown payload. `legacy: true` makes useClipboard fall back to execCommand when the async
// Clipboard API isn't available — which is the case inside the Figma plugin iframe. `copied` flips
// true for ~1.5s after a copy; we pair it with the last-copied id so only that row's button flashes.
const { copy: clipboardCopy, copied } = useClipboard({ legacy: true });
const copiedId = ref<string | null>(null);
const copy = (text: string, id: string): void => {
  copiedId.value = id;
  void clipboardCopy(text);
};

// Copy a full diagnostic bundle (versions + context + the ordered calls with their params/results)
// for pasting into a bug report. `$diagnostics` is a sentinel id so its button flashes independently.
const DIAGNOSTICS_ID = '$diagnostics';
const copyDiagnostics = (): void => {
  const bundle = buildDiagnosticBundle(state.value, context.value, {
    pluginVersion: appVersion,
    protocolVersion: PROTOCOL_VERSION,
    sessionId: client.sessionId,
    userAgent: navigator.userAgent,
  });
  copy(bundle, DIAGNOSTICS_ID);
};

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
    // A context push is proof the user is active here right now — a throttle-immune signal (postMessage
    // isn't clamped like background-tab timers). Nudge the relay to probe now in case a reconnect
    // stalled while backgrounded; wake() no-ops when already connected.
    client.wake();
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
  if (v !== 'visible') return;
  // Returning to the foreground unfreezes throttled timers. Browsers throttle (and after a few minutes
  // freeze) timers in hidden tabs, so a reconnect back-off that began while the user switched away — the
  // classic "opened the plugin, then launched the MCP client" flow — can stall long past when the server
  // came up. Nudge the client to probe now so it connects immediately instead of waiting out that sleep.
  client.wake();
  emitActivity();
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

// Drag-to-resize. The grip sits in the bottom-right corner, so the pointer's viewport coords during a
// drag are (≈) the desired window width/height (the iframe origin is the window's top-left). The
// sandbox does the authoritative clamp + figma.ui.resize; we clamp here too so the grip stops tracking
// at the floor instead of running away. `persist` on release tells the sandbox to remember the size.
const MIN_UI_WIDTH = 280;
const MIN_UI_HEIGHT = 300;
let resizing = false;

const postResize = (clientX: number, clientY: number, persist: boolean): void => {
  (globalThis as { parent?: { postMessage: (m: unknown, t: string) => void } }).parent?.postMessage(
    {
      pluginMessage: {
        type: 'ui:resize',
        width: Math.max(MIN_UI_WIDTH, Math.floor(clientX + 4)),
        height: Math.max(MIN_UI_HEIGHT, Math.floor(clientY + 4)),
        persist,
      },
    },
    '*',
  );
};

const onResizeStart = (e: PointerEvent): void => {
  resizing = true;
  (e.target as Element).setPointerCapture(e.pointerId);
};
const onResizeMove = (e: PointerEvent): void => {
  if (resizing) postResize(e.clientX, e.clientY, false);
};
const onResizeEnd = (e: PointerEvent): void => {
  if (!resizing) return;
  resizing = false;
  postResize(e.clientX, e.clientY, true);
};
</script>

<template>
  <main class="relative flex h-full flex-col bg-fig-bg text-fig-fg text-xs">
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
          <li v-for="e in state.activity" :key="e.id">
            <component
              :is="e.payload ? 'button' : 'div'"
              class="flex w-full items-center gap-2 text-left"
              :class="e.payload ? 'hover:text-fig-fg' : ''"
              @click="e.payload && toggle(e.id)"
            >
              <span v-if="e.payload" class="w-2 shrink-0 text-fig-muted">
                {{ expanded.has(e.id) ? '▾' : '▸' }}
              </span>
              <span v-else class="w-2 shrink-0" />
              <span :class="statusColor[e.status]">{{ statusGlyph[e.status] }}</span>
              <span class="min-w-0 truncate" :class="e.status === 'error' ? 'text-fig-danger' : ''">
                {{ e.method }}
              </span>
              <span class="ml-auto shrink-0 text-fig-muted">
                {{ e.durationMs === undefined ? '' : `${e.durationMs}ms` }}
              </span>
              <span class="w-9 shrink-0 text-right text-fig-muted">{{
                formatAgo(e.startedAt)
              }}</span>
            </component>

            <div v-if="e.payload && expanded.has(e.id)" class="mt-1 mb-2 ml-2">
              <template v-if="e.request">
                <p class="mb-1 text-fig-muted">request</p>
                <pre
                  class="mb-2 max-h-40 overflow-auto rounded bg-black/30 p-2 text-[11px] leading-snug"
                  >{{ e.request.preview }}</pre
                >
              </template>
              <div class="mb-1 flex items-center gap-2 text-fig-muted">
                <span class="min-w-0 truncate"
                  >payload → LLM · {{ formatSize(e.payload.bytes) }}</span
                >
                <button
                  class="ml-auto shrink-0 rounded border border-white/15 px-1.5 py-0.5 hover:bg-white/10 hover:text-fig-fg"
                  @click="copy(e.payload.preview, e.id)"
                >
                  {{ copied && copiedId === e.id ? 'copied' : 'copy' }}
                </button>
              </div>
              <pre
                class="max-h-64 overflow-auto rounded bg-black/30 p-2 text-[11px] leading-snug"
                >{{ e.payload.preview }}</pre
              >
              <p v-if="e.payload.truncated" class="mt-1 text-fig-muted">
                Showing the first part only — the full result was larger.
              </p>
            </div>
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
              <div v-if="state.serverVersion !== null">server · v{{ state.serverVersion }}</div>
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
          <div>
            <p class="mb-1 text-fig-muted">Diagnostics</p>
            <button
              class="rounded border border-white/15 px-2 py-0.5 hover:bg-white/10 hover:text-fig-fg disabled:opacity-40"
              :disabled="state.activity.length === 0"
              @click="copyDiagnostics"
            >
              {{ copied && copiedId === DIAGNOSTICS_ID ? 'Copied' : 'Copy diagnostic bundle' }}
            </button>
            <p class="mt-1 text-fig-muted">For bug reports · includes your design content.</p>
          </div>
        </div>
      </template>
    </section>

    <footer
      class="flex items-center gap-2 border-t border-white/10 px-3 py-1.5 text-[10px] text-fig-muted"
    >
      <span class="truncate">Figwright v{{ appVersion }} · {{ state.totalCalls }} calls</span>
      <button
        class="ml-auto shrink-0 rounded border border-white/15 px-1.5 py-0.5 text-fig-muted hover:bg-white/10 hover:text-fig-fg"
        title="Run in background — hides the panel; the relay stays connected. Reopen by running the plugin again."
        @click="runInBackground"
      >
        Run in background
      </button>
    </footer>

    <!-- Drag handle — Figma has no built-in resize grip, so we render one in the bottom-right corner. -->
    <div
      class="absolute right-0 bottom-0 flex size-3.5 cursor-nwse-resize touch-none items-end justify-end p-0.5 text-fig-muted hover:text-fig-fg"
      title="Drag to resize"
      @pointerdown="onResizeStart"
      @pointermove="onResizeMove"
      @pointerup="onResizeEnd"
      @pointercancel="onResizeEnd"
    >
      <svg
        viewBox="0 0 10 10"
        class="size-2.5"
        fill="none"
        stroke="currentColor"
        stroke-width="1.2"
        stroke-linecap="round"
      >
        <path d="M10 4 4 10M10 7.5 7.5 10" />
      </svg>
    </div>
  </main>
</template>
