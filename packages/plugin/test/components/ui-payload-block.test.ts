// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The clipboard itself is VueUse's problem, and the browser API it reaches for isn't available
 * under happy-dom. What belongs to this component is _what it hands over_ — so `useClipboard` is
 * stubbed at the module boundary and the tests assert on the handover and the resulting UI state.
 */
const clipboard = vi.hoisted(() => ({ copy: vi.fn<(text: string) => void>() }));

vi.mock('@vueuse/core', async importOriginal => {
  const actual = await importOriginal<typeof import('@vueuse/core')>();
  const { ref } = await import('vue');
  return {
    ...actual,
    // A fresh `copied` per call, mirroring the real per-instance flag.
    useClipboard: () => {
      const copied = ref(false);
      return {
        copy: (text: string) => {
          clipboard.copy(text);
          copied.value = true;
        },
        copied,
      };
    },
  };
});

const { default: UiPayloadBlock } = await import('../../ui/components/UiPayloadBlock.vue');

const mountPreview = (props: Record<string, unknown> = {}) =>
  mount(UiPayloadBlock, { props: { label: 'Payload → LLM', preview: '{"ok":true}', ...props } });

describe('UiPayloadBlock', () => {
  beforeEach(() => {
    clipboard.copy.mockClear();
  });

  it('renders the label and the preview body', () => {
    const wrapper = mountPreview();

    expect(wrapper.text()).toContain('Payload → LLM');
    expect(wrapper.find('pre').text()).toBe('{"ok":true}');
  });

  it('reports the size when one is given', () => {
    expect(mountPreview({ bytes: 4096 }).text()).toContain('4.0 KB');
  });

  // The request block has no meaningful "size fed to the LLM", so it passes no bytes at all.
  it('omits the size when none is given', () => {
    expect(mountPreview().text()).not.toContain('KB');
  });

  it('notes when the preview was cut short', () => {
    expect(mountPreview({ truncated: true }).text()).toContain('the full result was larger');
    expect(mountPreview({ truncated: false }).text()).not.toContain('the full result was larger');
  });

  it('hands the full preview text to the clipboard', async () => {
    const wrapper = mountPreview({ preview: 'copy-me' });

    await wrapper.find('button').trigger('click');

    expect(clipboard.copy).toHaveBeenCalledWith('copy-me');
  });

  it('confirms the copy in the button label', async () => {
    const wrapper = mountPreview();
    expect(wrapper.find('button').text()).toBe('Copy');

    await wrapper.find('button').trigger('click');

    expect(wrapper.find('button').text()).toBe('Copied');
  });

  // Each block owns its own flag, so copying the request must not light up the payload's button.
  it('keeps the copied state local to one block', async () => {
    const first = mountPreview({ preview: 'a' });
    const second = mountPreview({ preview: 'b' });

    await first.find('button').trigger('click');

    expect(first.find('button').text()).toBe('Copied');
    expect(second.find('button').text()).toBe('Copy');
  });

  // The row itself is a toggle button; a copy click inside it must not also collapse the row.
  it('does not let the copy click bubble to the row toggle', async () => {
    const onClick = vi.fn<() => void>();
    const wrapper = mount({
      components: { UiPayloadBlock },
      setup: () => ({ onClick }),
      template: `<div @click="onClick"><UiPayloadBlock label="L" preview="p" /></div>`,
    });

    await wrapper.find('button').trigger('click');

    expect(onClick).not.toHaveBeenCalled();
  });

  it('caps the preview height, overridable per slot', () => {
    expect(mountPreview().find('pre').classes()).toContain('max-h-64');
    expect(mountPreview({ maxHeight: 'max-h-40' }).find('pre').classes()).toContain('max-h-40');
  });
});
