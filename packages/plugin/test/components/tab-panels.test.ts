import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

// @vitest-environment happy-dom
import { createPluginContextEvent, type PluginContextEvent } from '../../protocol/bridge.js';
import TabActivity from '../../ui/components/TabActivity.vue';
import TabContext from '../../ui/components/TabContext.vue';
import TabDebug from '../../ui/components/TabDebug.vue';
import type { ActivityEntry, RelayClientState } from '../../ui/relay/state.js';

const entry = (over: Partial<ActivityEntry> = {}): ActivityEntry => ({
  id: 'req-1',
  method: 'get_node',
  startedAt: Date.now(),
  status: 'ok',
  ...over,
});

const state = (over: Partial<RelayClientState> = {}): RelayClientState => ({
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
  ...over,
});

describe('TabActivity', () => {
  it('lists one row per recorded call', () => {
    const wrapper = mount(TabActivity, {
      props: {
        activity: [entry({ id: 'a', method: 'get_node' }), entry({ id: 'b', method: 'set_fills' })],
        connected: true,
      },
    });

    expect(wrapper.findAll('li')).toHaveLength(2);
    expect(wrapper.text()).toContain('set_fills');
  });

  // The empty state has to distinguish "nothing has happened yet" from "we aren't even connected",
  // because the action the user needs to take is different.
  it('tells a connected user that the panel is simply idle', () => {
    const wrapper = mount(TabActivity, { props: { activity: [], connected: true } });

    expect(wrapper.text()).toContain('Connected and idle');
    expect(wrapper.text()).toContain('will show up here');
    expect(wrapper.find('.lucide-radio').exists()).toBe(true);
  });

  it('tells a disconnected user to start their agent', () => {
    const wrapper = mount(TabActivity, { props: { activity: [], connected: false } });

    expect(wrapper.text()).toContain('Waiting for the MCP client');
    expect(wrapper.text()).toContain('Start your agent');
  });
});

describe('TabContext', () => {
  const context = (over: Partial<PluginContextEvent> = {}): PluginContextEvent => ({
    ...createPluginContextEvent({
      fileName: 'Design File',
      pageId: 'p1',
      pageName: 'Page 1',
      selectionCount: 0,
      selection: [],
      editorType: 'figma',
      apiVersion: '1.0.0',
    }),
    ...over,
  });

  it('waits quietly before the sandbox has pushed anything', () => {
    const wrapper = mount(TabContext, { props: { context: null } });
    expect(wrapper.text()).toContain('Waiting for plugin context');
  });

  it('shows file, page and editor identity', () => {
    const wrapper = mount(TabContext, { props: { context: context() } });

    expect(wrapper.text()).toContain('Design File');
    expect(wrapper.text()).toContain('Page 1');
    expect(wrapper.text()).toContain('figma');
    expect(wrapper.text()).toContain('1.0.0');
  });

  it('says so when nothing is selected', () => {
    const wrapper = mount(TabContext, { props: { context: context() } });
    expect(wrapper.text()).toContain('Nothing selected');
  });

  it('lists selected nodes with type and size', () => {
    const wrapper = mount(TabContext, {
      props: {
        context: context({
          selectionCount: 1,
          selection: [{ id: '1:2', name: 'Card', type: 'FRAME', width: 320, height: 420 }],
        }),
      },
    });

    expect(wrapper.text()).toContain('Card');
    expect(wrapper.text()).toContain('FRAME');
    expect(wrapper.text()).toContain('320×420');
  });

  // The sandbox caps how many nodes it serializes, so a large selection must still report its size.
  it('counts the nodes the sandbox did not serialize', () => {
    const wrapper = mount(TabContext, {
      props: {
        context: context({
          selectionCount: 12,
          selection: [{ id: '1:2', name: 'Card', type: 'FRAME', width: 320, height: 420 }],
        }),
      },
    });

    expect(wrapper.text()).toContain('…and 11 more');
  });
});

describe('TabDebug', () => {
  const props = (over: Partial<RelayClientState> = {}) => ({
    state: state(over),
    sessionId: 'abcdefgh-1234-5678',
    pluginVersion: '0.3.0',
    buildDiagnostics: () => '{"schema":"test"}',
  });

  it('abbreviates the session id', () => {
    const wrapper = mount(TabDebug, { props: props() });
    expect(wrapper.text()).toContain('abcdefgh…');
  });

  it('flags a resumed session', () => {
    expect(mount(TabDebug, { props: props({ sessionResumed: true }) }).text()).toContain(
      '(resumed)',
    );
    expect(mount(TabDebug, { props: props({ sessionResumed: false }) }).text()).not.toContain(
      '(resumed)',
    );
  });

  it('surfaces the last connection error', () => {
    const wrapper = mount(TabDebug, { props: props({ lastError: 'ECONNREFUSED' }) });
    expect(wrapper.text()).toContain('ECONNREFUSED');
  });

  // Plugin and server ship separately, so a skew between them is a real diagnosis; showing both
  // here is what makes it visible at a glance.
  it('pairs the plugin version with the server’s', () => {
    const wrapper = mount(TabDebug, { props: props({ serverVersion: '0.4.0' }) });

    expect(wrapper.text()).toContain('Plugin');
    expect(wrapper.text()).toContain('v0.3.0');
    expect(wrapper.text()).toContain('Server');
    expect(wrapper.text()).toContain('v0.4.0');
  });

  // The server version is only known after the hello handshake.
  it('still reports the plugin version before the server is known', () => {
    const wrapper = mount(TabDebug, { props: props({ serverVersion: null }) });

    expect(wrapper.text()).toContain('v0.3.0');
    expect(wrapper.text()).not.toContain('Server');
  });

  it('lists only failed calls under recent errors', () => {
    const wrapper = mount(TabDebug, {
      props: props({
        activity: [
          entry({ id: 'a', method: 'get_node', status: 'ok' }),
          entry({ id: 'b', method: 'set_fills', status: 'error', error: 'no node' }),
        ],
      }),
    });

    expect(wrapper.text()).toContain('set_fills');
    expect(wrapper.text()).toContain('no node');
    expect(wrapper.text()).not.toContain('get_node');
  });

  it('says there are no errors when every call succeeded', () => {
    const wrapper = mount(TabDebug, { props: props({ activity: [entry()] }) });
    expect(wrapper.text()).toContain('No errors.');
  });

  // Nothing to report before any call has happened, so the button would produce an empty bundle.
  it('disables the diagnostics button until there is activity', () => {
    const empty = mount(TabDebug, { props: props({ activity: [] }) });
    expect(empty.find('button').attributes('disabled')).toBeDefined();

    const withCalls = mount(TabDebug, { props: props({ activity: [entry()] }) });
    expect(withCalls.find('button').attributes('disabled')).toBeUndefined();
  });

  it('warns that the bundle carries design content', () => {
    const wrapper = mount(TabDebug, { props: props() });
    expect(wrapper.text()).toContain('includes your design content');
  });

  describe('call statistics', () => {
    // Totals come from the uncapped counters, not from the retained list, so they stay honest once
    // the recent list has rolled over.
    it('reports the lifetime totals, not just what is still listed', () => {
      const wrapper = mount(TabDebug, {
        props: props({ totalCalls: 500, failedCalls: 7, activity: [entry()] }),
      });

      expect(wrapper.text()).toContain('500');
      expect(wrapper.text()).toContain('7');
    });

    it('reddens the failure count only when something failed', () => {
      const clean = mount(TabDebug, { props: props({ totalCalls: 5, failedCalls: 0 }) });
      const broken = mount(TabDebug, { props: props({ totalCalls: 5, failedCalls: 1 }) });

      expect(clean.find('dd.text-danger').exists()).toBe(false);
      expect(broken.find('dd.text-danger').exists()).toBe(true);
    });

    it('averages the duration of the calls it can still see', () => {
      const wrapper = mount(TabDebug, {
        props: props({
          activity: [entry({ id: 'a', durationMs: 100 }), entry({ id: 'b', durationMs: 300 })],
        }),
      });

      expect(wrapper.text()).toContain('200ms');
    });

    // A call still in flight has no duration yet and would drag the mean toward zero.
    it('leaves pending calls out of the average', () => {
      const wrapper = mount(TabDebug, {
        props: props({
          activity: [entry({ id: 'a', durationMs: 200 }), entry({ id: 'b', status: 'pending' })],
        }),
      });

      expect(wrapper.text()).toContain('200ms');
    });

    it('omits the average until something has finished', () => {
      const wrapper = mount(TabDebug, { props: props({ activity: [] }) });

      expect(wrapper.text()).not.toContain('Avg');
    });
  });
});
