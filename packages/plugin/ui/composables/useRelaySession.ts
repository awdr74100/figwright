import { DEFAULT_PORT, PROTOCOL_VERSION } from '@figwright/shared';
import { tryOnScopeDispose, useDocumentVisibility } from '@vueuse/core';
import { computed, type ComputedRef, onMounted, type Ref, ref, watch } from 'vue';

import { type PluginContextEvent } from '../../protocol/bridge.js';
import { RelayClient } from '../relay/client.js';
import { buildDiagnosticBundle } from '../relay/diagnostics.js';
import type { RelayClientState } from '../relay/state.js';
import { onSandboxContext } from '../sandbox/messaging.js';
import { createToolBridge } from '../sandbox/tool-bridge.js';

export interface RelaySession {
  /** Live mirror of the relay client's state. */
  state: Ref<RelayClientState>;
  /** Latest context pushed up from the sandbox, or null before the first push. */
  context: Ref<PluginContextEvent | null>;
  /** True while at least one tool call is in flight. */
  busy: ComputedRef<boolean>;
  sessionId: string;
  /** Serialized bundle (versions + context + calls) for pasting into a bug report. */
  buildDiagnostics: () => string;
}

/**
 * Owns the relay connection for the panel: the client and sandbox bridge, their lifecycle, and the
 * activity/visibility signalling that decides which open file the leader routes tool calls to.
 *
 * That routing behaviour is the reason this lives in one composable rather than being spread across
 * components — the invariants below are subtle and were arrived at empirically.
 */
export const useRelaySession = (appVersion: string): RelaySession => {
  const client = new RelayClient({
    // The relay leader always binds DEFAULT_PORT — the server never hops to a fallback — so we probe
    // exactly that one port. Scanning a range would only risk stalling on unrelated local services.
    ports: [DEFAULT_PORT],
    clientVersion: appVersion,
    log: msg => console.log(msg),
  });
  const bridge = createToolBridge({ log: msg => console.log(msg) });
  client.setToolHandler(bridge.handler);

  const state = ref<RelayClientState>(client.getState());
  const context = ref<PluginContextEvent | null>(null);
  const visibility = useDocumentVisibility();

  // Re-assert this session's activity from the latest known context. The leader routes to the
  // most-recently-active session, so emitting from the foreground bumps this plugin to the front.
  // No-op until the sandbox has pushed at least one context (file/page identity is required by
  // ActivityParams).
  const emitActivity = (): void => {
    const c = context.value;
    if (c === null) return;
    // Only the foreground tab reports `visible`; background tabs are `hidden` (verified empirically on
    // Figma desktop). That flag — not whether the event is sent — is what gates routing: only the file
    // the user is actually looking at ever claims it, so switching tabs auto-follows the foreground
    // file and a background tab can never steal routing via a broadcast focus/visibility event. See
    // [[project-routing-stability-backlog]].
    //
    // The event itself is sent either way, because it also carries this session's identity, and a
    // background tab suppressing that left the leader with no name for any file the user had not
    // recently been in — including, right after any reconnect, all of them. `use_file` matches on
    // those names, so withholding them made a plainly-open file unclaimable.
    //
    // Unless the server is too old to read the flag, in which case any event at all is a claim on
    // routing and a hidden tab has to stay quiet — the pre-negotiation behaviour, exactly.
    const foreground = visibility.value === 'visible';
    if (!foreground && !state.value.foregroundFlag) return;
    client.notifyActivity({
      fileName: c.fileName,
      pageId: c.pageId,
      pageName: c.pageName,
      foreground,
    });
  };

  const stopContext = onSandboxContext(event => {
    context.value = event;
    // A context push is proof the user is active here right now — a throttle-immune signal (postMessage
    // isn't clamped like background-tab timers). Nudge the relay to probe now in case a reconnect
    // stalled while backgrounded; wake() no-ops when already connected.
    client.wake();
    // Each context push from sandbox means the user just interacted (open / selection-change /
    // page-change). Tell the leader — params carry file/page identity so ping can report which
    // file is being routed instead of an opaque session id.
    emitActivity();
  });

  // When this tab becomes the foreground (visibility → 'visible'), re-assert activity so routing follows
  // the file the user switched to — even with no canvas click. `useDocumentVisibility` is backed solely by
  // the `visibilitychange` event, which only fires on the tab whose visibility actually changed. We
  // deliberately do NOT react to window `focus`: that fires on EVERY tab when the user returns to the Figma
  // app (it's not per-tab), which is exactly the broadcast that made background files steal routing.
  // Only the → visible edge is worth an event; going to the background changes neither this session's
  // identity nor who should own routing, so there is nothing to say.
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
  //
  // Re-announcing on every fresh connection is what makes the identity half of $activity reliable.
  // A leader that has just taken the port has no record of this session — the id is minted by the
  // plugin and survives, but the *server* holding it does not — so it starts out knowing nothing
  // about which file this is. Nothing else would tell it until the user next clicked something in
  // this tab, and every leader handover and server restart puts every open plugin in that state at
  // once. Sent with the real foreground flag, so a background tab re-announcing cannot take routing.
  let wasConnected = false;
  const stopSubscribe = client.subscribe(s => {
    state.value = s;
    const isConnected = s.status === 'connected';
    if (isConnected && !wasConnected) emitActivity();
    wasConnected = isConnected;
  });
  tryOnScopeDispose(() => {
    stopSubscribe();
    stopContext();
    bridge.dispose();
    client.disconnect().catch(() => {});
  });

  onMounted(() => {
    client.connect().catch(err => console.warn('[relay-client] initial connect failed:', err));
  });

  return {
    state,
    context,
    // Derived here rather than in the panel: "the agent is working" is a fact about the session, and
    // more than one piece of chrome reads it.
    busy: computed(() => state.value.activity.some(e => e.status === 'pending')),
    sessionId: client.sessionId,
    buildDiagnostics: () =>
      buildDiagnosticBundle(state.value, context.value, {
        pluginVersion: appVersion,
        protocolVersion: PROTOCOL_VERSION,
        sessionId: client.sessionId,
        userAgent: navigator.userAgent,
      }),
  };
};
