// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Minimising is the panel-window module's job; the footer only has to ask for it.
const runInBackground = vi.hoisted(() => vi.fn<() => void>());
vi.mock('../../ui/composables/usePanelWindow.js', () => ({
  usePanelWindow: () => ({
    runInBackground,
    onResizeStart: vi.fn<() => void>(),
    onResizeMove: vi.fn<() => void>(),
    onResizeEnd: vi.fn<() => void>(),
  }),
}));

const { default: PanelFooter } = await import('../../ui/components/PanelFooter.vue');

const mountFooter = (over: { totalCalls?: number; failedCalls?: number } = {}) =>
  mount(PanelFooter, {
    props: { version: '0.3.0', totalCalls: 0, failedCalls: 0, ...over },
  });

describe('PanelFooter', () => {
  beforeEach(() => {
    runInBackground.mockClear();
  });

  it('shows the product version and how many calls have run', () => {
    const wrapper = mountFooter({ totalCalls: 24 });

    expect(wrapper.text()).toContain('v0.3.0');
    expect(wrapper.text()).toContain('24 calls');
  });

  // A permanent "0 failed" would be noise on every healthy session; the number exists to catch the
  // eye precisely when it isn't zero.
  it('says nothing about failures while there are none', () => {
    expect(mountFooter({ totalCalls: 24, failedCalls: 0 }).text()).not.toContain('failed');
  });

  it('calls out failures once any call has failed', () => {
    const wrapper = mountFooter({ totalCalls: 24, failedCalls: 3 });

    expect(wrapper.text()).toContain('3 failed');
    expect(wrapper.find('.text-danger').exists()).toBe(true);
  });

  it('asks the sandbox to hide the panel', async () => {
    await mountFooter().find('button').trigger('click');

    expect(runInBackground).toHaveBeenCalled();
  });
});
