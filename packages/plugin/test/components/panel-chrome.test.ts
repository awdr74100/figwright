// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import { createPluginContextEvent, type PluginContextEvent } from '../../protocol/bridge.js';
import type { RelayClientState } from '../../ui/relay/state.js';

/**
 * The panel draws its own window chrome — a resize grip and a run-in-background button — because
 * Figma gives a plugin window neither. In Dev Mode's Inspect panel there is none to act on,
 * confirmed live with the guard disabled: dragging the grip does nothing, and run-in-background
 * empties the panel with no way back short of closing the plugin — which drops the relay socket the
 * button exists to keep. Both controls have to withdraw, and nothing else in the suite would notice
 * if a refactor dropped the `v-if`.
 */
const contextRef = ref<PluginContextEvent | null>(null);

const state: RelayClientState = {
  status: 'connected',
  port: 3055,
  sessionResumed: false,
  serverVersion: '0.3.0',
  lastError: null,
  connectedAt: Date.now(),
  reconnectCount: 0,
  totalCalls: 0,
  failedCalls: 0,
  activity: [],
};

vi.mock('../../ui/composables/useRelaySession.js', () => ({
  useRelaySession: () => ({
    state: ref(state),
    context: contextRef,
    busy: ref(false),
    sessionId: ref('sess-1'),
    buildDiagnostics: (): string => '{}',
  }),
}));

const { default: App } = await import('../../ui/App.vue');

const context = (mode: string): PluginContextEvent =>
  createPluginContextEvent({
    fileName: 'Design File',
    pageId: 'p1',
    pageName: 'Page 1',
    selectionCount: 0,
    selection: [],
    editorType: mode === 'inspect' ? 'dev' : 'figma',
    mode,
    apiVersion: '1.0.0',
  });

/** The grip is a bare div, identified the way a user finds it: the resize cursor and its tooltip. */
const grip = (wrapper: ReturnType<typeof mount>) => wrapper.find('[title="Drag to resize"]');
const backgroundButton = (wrapper: ReturnType<typeof mount>) =>
  wrapper.find('[aria-label="Run in background"]');

describe('App window chrome', () => {
  it('draws the grip and background button in a floating plugin window', () => {
    contextRef.value = context('default');

    const wrapper = mount(App);

    expect(grip(wrapper).exists()).toBe(true);
    expect(backgroundButton(wrapper).exists()).toBe(true);
  });

  it('withdraws both when embedded in Dev Mode’s Inspect panel', () => {
    contextRef.value = context('inspect');

    const wrapper = mount(App);

    expect(grip(wrapper).exists()).toBe(false);
    expect(backgroundButton(wrapper).exists()).toBe(false);
  });

  // The sandbox pushes context on startup, so the unknown window is a frame or two. It has to
  // default to the floating case: a plugin window flashing its own chrome away is worse than the
  // Inspect panel showing it for one frame, and the floating window is the overwhelmingly common
  // case.
  it('assumes a floating window until the sandbox has said otherwise', () => {
    contextRef.value = null;

    const wrapper = mount(App);

    expect(grip(wrapper).exists()).toBe(true);
    expect(backgroundButton(wrapper).exists()).toBe(true);
  });
});
