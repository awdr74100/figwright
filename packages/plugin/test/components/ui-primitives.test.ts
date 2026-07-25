// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The clipboard itself is VueUse's problem, and the browser API it reaches for isn't available
 * under happy-dom. What belongs to the button is _what it hands over_ — so `useClipboard` is
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

const { default: UiCopyButton } = await import('../../ui/components/UiCopyButton.vue');
const { default: UiMetaRow } = await import('../../ui/components/UiMetaRow.vue');
const { default: UiSection } = await import('../../ui/components/UiSection.vue');

describe('UiMetaRow', () => {
  const mountRow = (props: Record<string, unknown> = {}) =>
    mount(UiMetaRow, { props: { label: 'Session', ...props }, slots: { default: 'abcdefgh' } });

  it('pairs the label with its value', () => {
    const wrapper = mountRow();

    expect(wrapper.find('dt').text()).toBe('Session');
    expect(wrapper.find('dd').text()).toBe('abcdefgh');
  });

  // A name the user chose can run arbitrarily long, and the panel is 280px at its floor.
  it('cuts a long value off rather than widening the row, when asked', () => {
    expect(mountRow({ truncate: true }).find('dd').classes()).toEqual(
      expect.arrayContaining(['min-w-0', 'truncate']),
    );
  });

  // A version or an id is short and its tail matters — truncating one would hide the part you came
  // to read.
  it('leaves values whole by default', () => {
    expect(mountRow().find('dd').classes()).not.toContain('truncate');
  });

  it('renders values as prose by default', () => {
    const classes = mountRow().find('dd').classes();

    expect(classes).not.toContain('font-mono');
    expect(classes).not.toContain('tabular-nums');
  });

  // Digits line up column-wise, so a number that changes doesn't make the row twitch.
  it('renders data values monospaced with tabular figures', () => {
    expect(mountRow({ mono: true }).find('dd').classes()).toEqual(
      expect.arrayContaining(['font-mono', 'tabular-nums', 'text-meta']),
    );
  });

  // The fallthrough class lands on the row, so tinting the value needs its own way in.
  it('applies caller classes to the value, not to the row', () => {
    const wrapper = mountRow({ valueClass: 'text-danger' });

    expect(wrapper.find('dd').classes()).toContain('text-danger');
    expect(wrapper.classes()).not.toContain('text-danger');
  });
});

describe('UiSection', () => {
  const mountSection = (props: Record<string, unknown> = {}) =>
    mount(UiSection, { props, slots: { default: '<p>body</p>' } });

  it('titles the block and renders its body', () => {
    const wrapper = mountSection({ title: 'Connection' });

    expect(wrapper.text()).toContain('Connection');
    expect(wrapper.text()).toContain('body');
  });

  // A lead-in block carries content that needs no heading of its own.
  it('omits the heading when untitled', () => {
    const wrapper = mountSection();

    expect(wrapper.find('p.uppercase').exists()).toBe(false);
    expect(wrapper.text()).toContain('body');
  });

  // Separators come from the parent's `divide-y`, so a section never has to know it is first —
  // it only flattens its own outer padding.
  it('keeps its edges flush so the parent owns the rules between sections', () => {
    expect(mountSection().classes()).toEqual(expect.arrayContaining(['first:pt-0', 'last:pb-0']));
  });
});

describe('UiCopyButton', () => {
  const mountButton = (props: Record<string, unknown> = {}) =>
    mount(UiCopyButton, { props: { label: 'Copy', value: 'copy-me', ...props } });

  beforeEach(() => {
    clipboard.copy.mockClear();
  });

  it('hands its value to the clipboard', async () => {
    await mountButton().trigger('click');

    expect(clipboard.copy).toHaveBeenCalledWith('copy-me');
  });

  it('confirms the copy in the label', async () => {
    const wrapper = mountButton({ label: 'Copy diagnostic bundle' });
    expect(wrapper.text()).toBe('Copy diagnostic bundle');

    await wrapper.trigger('click');

    expect(wrapper.text()).toBe('Copied');
  });

  // Each button owns its own flag, so copying one block must not light up another's.
  it('keeps the copied state local to one button', async () => {
    const first = mountButton({ value: 'a' });
    const second = mountButton({ value: 'b' });

    await first.trigger('click');

    expect(first.text()).toBe('Copied');
    expect(second.text()).toBe('Copy');
  });

  // The diagnostic bundle embeds every recorded call, so it must only be serialized on click.
  describe('a value that is expensive to produce', () => {
    it('is not built until the button is clicked', async () => {
      const build = vi.fn<() => string>(() => 'built');
      const wrapper = mountButton({ value: build });
      expect(build).not.toHaveBeenCalled();

      await wrapper.trigger('click');

      expect(build).toHaveBeenCalledTimes(1);
      expect(clipboard.copy).toHaveBeenCalledWith('built');
    });
  });

  it('does nothing while disabled', async () => {
    const wrapper = mountButton({ disabled: true });

    await wrapper.trigger('click');

    expect(wrapper.attributes('disabled')).toBeDefined();
    expect(clipboard.copy).not.toHaveBeenCalled();
  });

  // These sit inside rows that are themselves toggle buttons; copying must never also expand or
  // collapse what you were reading.
  it('does not let the click bubble to an enclosing toggle', async () => {
    const onClick = vi.fn<() => void>();
    const wrapper = mount({
      components: { UiCopyButton },
      setup: () => ({ onClick }),
      template: `<div @click="onClick"><UiCopyButton label="Copy" value="x" /></div>`,
    });

    await wrapper.find('button').trigger('click');

    expect(onClick).not.toHaveBeenCalled();
  });

  it('offers a tighter geometry for sitting inline in a header row', () => {
    expect(mountButton({ compact: true }).classes()).toContain('px-1.5');
    expect(mountButton().classes()).toContain('px-2');
  });
});
