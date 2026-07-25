// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import PanelTabs from '../../ui/components/PanelTabs.vue';
import { TABS } from '../../ui/lib/tabs.js';

const mountTabs = (modelValue: 'activity' | 'context' | 'debug' = 'activity') =>
  mount(PanelTabs, { props: { modelValue } });

/** The sliding pill is the only absolutely-positioned span in the nav. */
const indicatorTransform = (wrapper: ReturnType<typeof mountTabs>): string =>
  wrapper.find('span.absolute').attributes('style') ?? '';

describe('PanelTabs', () => {
  it('renders every tab in order', () => {
    const labels = mountTabs()
      .findAll('button')
      .map(b => b.text());

    expect(labels).toEqual(TABS.map(([, label]) => label));
  });

  it('emits the tab id through v-model when a tab is clicked', async () => {
    const wrapper = mountTabs();

    await wrapper.findAll('button')[1]?.trigger('click');

    expect(wrapper.emitted('update:modelValue')).toEqual([['context']]);
  });

  it('marks only the active tab as emphasized', () => {
    const buttons = mountTabs('context').findAll('button');

    expect(buttons[0]?.classes()).toContain('text-dim');
    expect(buttons[1]?.classes()).toContain('font-medium');
    expect(buttons[2]?.classes()).toContain('text-dim');
  });

  // The indicator animates via transform rather than re-layout, so its offset must track the index.
  it('parks the indicator at the active tab index', () => {
    expect(indicatorTransform(mountTabs('activity'))).toContain('translateX(calc(0 *');
    expect(indicatorTransform(mountTabs('context'))).toContain('translateX(calc(1 *');
    expect(indicatorTransform(mountTabs('debug'))).toContain('translateX(calc(2 *');
  });
});
