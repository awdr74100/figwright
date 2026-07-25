// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import TabBar from '../../ui/components/TabBar.vue';
import { TABS } from '../../ui/lib/tabs.js';

const mountTabBar = (modelValue: 'activity' | 'context' | 'debug' = 'activity') =>
  mount(TabBar, { props: { modelValue } });

/** The sliding pill is the only absolutely-positioned span in the nav. */
const indicatorTransform = (wrapper: ReturnType<typeof mountTabBar>): string =>
  wrapper.find('span.absolute').attributes('style') ?? '';

describe('TabBar', () => {
  it('renders every tab in order', () => {
    const labels = mountTabBar()
      .findAll('button')
      .map(b => b.text());

    expect(labels).toEqual(TABS.map(([, label]) => label));
  });

  it('emits the tab id through v-model when a tab is clicked', async () => {
    const wrapper = mountTabBar();

    await wrapper.findAll('button')[1]?.trigger('click');

    expect(wrapper.emitted('update:modelValue')).toEqual([['context']]);
  });

  it('marks only the active tab as emphasized', () => {
    const buttons = mountTabBar('context').findAll('button');

    expect(buttons[0]?.classes()).toContain('text-dim');
    expect(buttons[1]?.classes()).toContain('font-medium');
    expect(buttons[2]?.classes()).toContain('text-dim');
  });

  // The indicator animates via transform rather than re-layout, so its offset must track the index.
  it('parks the indicator at the active tab index', () => {
    expect(indicatorTransform(mountTabBar('activity'))).toContain('translateX(calc(0 *');
    expect(indicatorTransform(mountTabBar('context'))).toContain('translateX(calc(1 *');
    expect(indicatorTransform(mountTabBar('debug'))).toContain('translateX(calc(2 *');
  });
});
