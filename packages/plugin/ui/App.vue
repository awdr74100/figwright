<script setup lang="ts">
import { computed, ref } from 'vue';

import { isEmbeddedInPanel } from '../protocol/editor-context.js';
import PanelBackgroundButton from './components/PanelBackgroundButton.vue';
import PanelFooter from './components/PanelFooter.vue';
import PanelGrip from './components/PanelGrip.vue';
import PanelStatus from './components/PanelStatus.vue';
import PanelTabs from './components/PanelTabs.vue';
import TabActivity from './components/TabActivity.vue';
import TabContext from './components/TabContext.vue';
import TabDebug from './components/TabDebug.vue';
import { useRelaySession } from './composables/useRelaySession.js';
import type { Tab } from './lib/tabs.js';

const appVersion = __APP_VERSION__;

const { state, context, busy, sessionId, buildDiagnostics } = useRelaySession(appVersion);

const tab = ref<Tab>('activity');

/**
 * In Dev Mode's Inspect panel our UI is an iframe filling a panel Figma sizes, so neither piece of
 * window chrome the panel draws for itself survives the move. Both were exercised live there, with
 * the guard deliberately disabled:
 *
 * - The resize grip does nothing at all — `figma.ui.resize` has no window to move.
 * - "run in background" is worse than inert. `figma.ui.hide()` empties the panel and leaves a
 *   "running Figwright" strip behind with no way back: the `run` listener that re-shows a hidden
 *   window is a plugin-window mechanism, so the only exit is closing the plugin — which drops the
 *   relay socket, the exact thing this button exists to preserve.
 *
 * So this is not tidying away two no-ops; one of them is a trap.
 *
 * Defaults to showing them while `context` is still null: the sandbox pushes context on startup, so
 * the gap is a frame or two, and a floating window — the overwhelmingly common case — must not
 * flash its own chrome in.
 */
const embedded = computed(() => context.value !== null && isEmbeddedInPanel(context.value.mode));
</script>

<template>
  <main
    class="relative flex h-full scrollbar-thin scrollbar-thumb-line-strong scrollbar-track-transparent flex-col bg-surface text-panel text-fg"
  >
    <!-- Indeterminate sweep along the panel's top edge — the one ambient signal that the agent is
         mid-call. It sits above the header rather than under the tabs, where a moving line would
         read as a tab underline and fight the selected-tab pill. -->
    <span v-if="busy" class="absolute inset-x-0 top-0 z-10 block h-0.5 overflow-hidden">
      <span class="block h-full w-1/4 animate-sweep bg-brand" />
    </span>

    <header class="relative shrink-0 border-b border-line px-3 pt-2.5 pb-2">
      <div class="flex items-center gap-1.5">
        <PanelStatus
          class="min-w-0 flex-1"
          :status="state.status"
          :port="state.port"
          :connected-at="state.connectedAt"
        />
        <PanelBackgroundButton v-if="!embedded" />
      </div>
      <!-- Something about this build's version that no reconnect will change: it is behind the
           server (still works, results may be incomplete), or the server refused it outright over
           the wire format (nothing works). Both are only fixed by updating the plugin, so both are
           stated where the user already is rather than in the Debug tab.

           Severity is read off the connection rather than stored: a refusal never reaches
           'connected', so a notice on a live connection is the survivable one. -->
      <p
        v-if="state.versionNotice !== null"
        class="mt-2 rounded-md bg-raised p-1.5 text-meta wrap-break-word"
        :class="state.status === 'connected' ? 'text-warning' : 'text-danger'"
      >
        {{ state.versionNotice }}
      </p>
      <PanelTabs v-model="tab" class="mt-2.5" />
    </header>

    <!-- The bottom gap belongs to the scrolled panel, not to this scroller: Chromium leaves
         `padding-bottom` out of a scroll container's scrollable overflow, so a `py-2` here reads as
         three-sided the moment the list is long enough to scroll — the last row ends up flush
         against the footer.

         The panel is `min-h-full`, not `h-full`, for a second reason that looks identical until it
         isn't: under border-box `h-full` pins the panel to the viewport height, so its padding is
         carved out of the content box rather than trailing the content, and overflowing content
         scrolls straight past it. `min-h-full` still fills a short panel (the empty states center
         against it) but lets a long one grow, which is what puts the padding after the last row. -->
    <section class="flex-1 overflow-x-hidden overflow-y-auto px-2 pt-2">
      <!-- `leave: 0` keeps a tab switch instant; only the incoming panel animates. -->
      <Transition name="tab" mode="out-in" :duration="{ enter: 150, leave: 0 }">
        <div :key="tab" class="flex min-h-full flex-col pb-2">
          <TabActivity
            v-if="tab === 'activity'"
            :activity="state.activity"
            :connected="state.status === 'connected'"
          />
          <TabContext v-else-if="tab === 'context'" :context="context" />
          <TabDebug
            v-else
            :state="state"
            :session-id="sessionId"
            :plugin-version="appVersion"
            :build-diagnostics="buildDiagnostics"
          />
        </div>
      </Transition>
    </section>

    <PanelFooter
      :version="appVersion"
      :total-calls="state.totalCalls"
      :failed-calls="state.failedCalls"
    />
    <PanelGrip v-if="!embedded" />
  </main>
</template>
