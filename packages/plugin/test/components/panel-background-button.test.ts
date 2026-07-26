// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Hiding the panel is the panel-window module's job; the button only has to ask for it.
const runInBackground = vi.hoisted(() => vi.fn<() => void>());
vi.mock('../../ui/composables/usePanelWindow.js', () => ({
  usePanelWindow: () => ({
    runInBackground,
    onResizeStart: vi.fn<() => void>(),
    onResizeMove: vi.fn<() => void>(),
    onResizeEnd: vi.fn<() => void>(),
  }),
}));

const { default: PanelBackgroundButton } =
  await import('../../ui/components/PanelBackgroundButton.vue');

describe('PanelBackgroundButton', () => {
  beforeEach(() => {
    runInBackground.mockClear();
  });

  it('asks the sandbox to hide the panel', async () => {
    await mount(PanelBackgroundButton).find('button').trigger('click');

    expect(runInBackground).toHaveBeenCalled();
  });

  // The label is dropped to fit the header row, so the accessible name and the tooltip are the only
  // things left explaining what this does — and the tooltip is where "stays connected" lives.
  it('stays explainable without a visible label', () => {
    const button = mount(PanelBackgroundButton).find('button');

    expect(button.text()).toBe('');
    expect(button.attributes('aria-label')).toBe('Run in background');
    expect(button.attributes('title')).toContain('relay stays connected');
  });
});
