// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import PanelStatus from '../../ui/components/PanelStatus.vue';
import type { RelayStatus } from '../../ui/relay/state.js';

const mountStatus = (props: {
  status: RelayStatus;
  port?: number | null;
  connectedAt?: number | null;
}) => mount(PanelStatus, { props: { port: null, connectedAt: null, ...props } });

/** The pulsing ring is the absolutely-positioned span inside the dot. */
const hasPingRing = (wrapper: ReturnType<typeof mountStatus>): boolean =>
  wrapper.find('span.animate-ping-ring').exists();

describe('PanelStatus', () => {
  it('labels every relay status', () => {
    const cases: Array<[RelayStatus, string]> = [
      ['idle', 'Idle'],
      ['connecting', 'Connecting'],
      ['connected', 'Connected'],
      ['reconnecting', 'Reconnecting'],
      ['disconnected', 'Disconnected'],
    ];

    for (const [status, label] of cases) {
      expect(mountStatus({ status }).text()).toContain(label);
    }
  });

  // The ring communicates "in flight". A settled connection — good or bad — must not pulse.
  it('pulses only while the connection is still settling', () => {
    expect(hasPingRing(mountStatus({ status: 'connecting' }))).toBe(true);
    expect(hasPingRing(mountStatus({ status: 'reconnecting' }))).toBe(true);
    expect(hasPingRing(mountStatus({ status: 'connected' }))).toBe(false);
    expect(hasPingRing(mountStatus({ status: 'disconnected' }))).toBe(false);
    expect(hasPingRing(mountStatus({ status: 'idle' }))).toBe(false);
  });

  it('gives the dot a glow only when live', () => {
    // The dot itself is the relative rounded span; the wrapper is a flex box and the ping ring is
    // absolutely positioned, so this selector matches neither.
    const dot = (status: RelayStatus) => mountStatus({ status }).find('span.relative.rounded-full');

    expect(dot('connected').classes().join(' ')).toContain('shadow-');
    expect(dot('disconnected').classes().join(' ')).not.toContain('shadow-');
  });

  it('tones the dot by status', () => {
    expect(mountStatus({ status: 'connected' }).html()).toContain('text-success');
    expect(mountStatus({ status: 'connecting' }).html()).toContain('text-warning');
    expect(mountStatus({ status: 'disconnected' }).html()).toContain('text-danger');
  });

  describe('meta line', () => {
    it('shows port and uptime once connected', () => {
      const wrapper = mountStatus({
        status: 'connected',
        port: 3055,
        connectedAt: Date.now() - 5_000,
      });

      expect(wrapper.text()).toContain(':3055');
      expect(wrapper.text()).toContain('up 5s');
    });

    it('omits the port when the client has none', () => {
      const wrapper = mountStatus({ status: 'connected', port: null, connectedAt: null });

      expect(wrapper.text()).not.toContain(':');
    });

    // Port and uptime describe a live connection; showing them while reconnecting would be a lie.
    it('stays blank unless connected', () => {
      const wrapper = mountStatus({
        status: 'reconnecting',
        port: 3055,
        connectedAt: Date.now() - 5_000,
      });

      expect(wrapper.text()).not.toContain('3055');
    });
  });
});
