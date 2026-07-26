<script setup lang="ts">
import { ref } from 'vue';

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
        <PanelBackgroundButton />
      </div>
      <PanelTabs v-model="tab" class="mt-2.5" />
    </header>

    <section class="flex-1 overflow-x-hidden overflow-y-auto px-2 py-2">
      <!-- `leave: 0` keeps a tab switch instant; only the incoming panel animates. -->
      <Transition name="tab" mode="out-in" :duration="{ enter: 150, leave: 0 }">
        <div :key="tab" class="h-full">
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
    <PanelGrip />
  </main>
</template>
