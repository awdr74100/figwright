<script setup lang="ts">
import { computed, ref } from 'vue';

import ActivityPanel from './components/ActivityPanel.vue';
import ConnectionStatus from './components/ConnectionStatus.vue';
import ContextPanel from './components/ContextPanel.vue';
import DebugPanel from './components/DebugPanel.vue';
import PanelFooter from './components/PanelFooter.vue';
import ResizeGrip from './components/ResizeGrip.vue';
import TabBar from './components/TabBar.vue';
import { useRelaySession } from './composables/useRelaySession.js';
import type { Tab } from './lib/tabs.js';

const appVersion = __APP_VERSION__;

const { state, context, sessionId, buildDiagnostics } = useRelaySession(appVersion);

const tab = ref<Tab>('activity');

// At least one tool call is in flight — surfaced as a sweep at the panel's top edge so it reads as
// "the agent is working" even when the row itself is scrolled out of view.
const busy = computed(() => state.value.activity.some(e => e.status === 'pending'));
</script>

<template>
  <main
    class="relative flex h-full flex-col bg-surface text-fg text-[11px] scrollbar-thin scrollbar-track-transparent scrollbar-thumb-line-strong"
  >
    <!-- Indeterminate sweep along the panel's top edge — the one ambient signal that the agent is
         mid-call. It sits above the header rather than under the tabs, where a moving line would
         read as a tab underline and fight the selected-tab pill. -->
    <span v-if="busy" class="absolute inset-x-0 top-0 z-10 block h-0.5 overflow-hidden">
      <span class="block h-full w-1/4 bg-brand animate-sweep" />
    </span>

    <header class="relative shrink-0 border-b border-line px-3 pt-2.5 pb-2">
      <ConnectionStatus
        :status="state.status"
        :port="state.port"
        :connected-at="state.connectedAt"
      />
      <TabBar v-model="tab" class="mt-2.5" />
    </header>

    <section class="flex-1 overflow-x-hidden overflow-y-auto px-2 py-2">
      <!-- `leave: 0` keeps a tab switch instant; only the incoming panel animates. -->
      <Transition name="tab" mode="out-in" :duration="{ enter: 150, leave: 0 }">
        <div :key="tab" class="h-full">
          <ActivityPanel
            v-if="tab === 'activity'"
            :activity="state.activity"
            :connected="state.status === 'connected'"
          />
          <ContextPanel v-else-if="tab === 'context'" :context="context" />
          <DebugPanel
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
    <ResizeGrip />
  </main>
</template>
