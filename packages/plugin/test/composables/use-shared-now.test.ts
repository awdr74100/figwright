// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, watch } from 'vue';

import { useSharedNow } from '../../ui/composables/useSharedNow.js';

/**
 * The clock's rate is the thing worth pinning. `useNow` defaults to `useRafFn`, so an options
 * object that stops saying otherwise still type-checks, still returns a reactive `Date`, and still
 * renders correct text — it just rebuilds it sixty times a second inside a Figma plugin iframe to
 * feed labels that change once. Nothing else here can see that, which is how the VueUse 15 upgrade
 * (`{ interval: 1000 }` removed in favour of `scheduler`) could have landed as a silent
 * regression.
 */
describe('useSharedNow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('ticks once a second, not once an animation frame', async () => {
    const scope = effectScope();
    let ticks = 0;

    scope.run(() => {
      watch(useSharedNow(), () => (ticks += 1), { flush: 'sync' });
    });

    // happy-dom backs `requestAnimationFrame` with a timer, so fake time drives either scheduler
    // and the two are told apart by rate alone: reverted to `useNow()`'s default, this same second
    // measures 62 ticks.
    await vi.advanceTimersByTimeAsync(1000);
    expect(ticks).toBe(1);

    await vi.advanceTimersByTimeAsync(2000);
    expect(ticks).toBe(3);

    scope.stop();
  });

  it('hands every consumer the same clock', () => {
    const scope = effectScope();

    const [first, second] = scope.run(() => [useSharedNow(), useSharedNow()]) ?? [];

    expect(first).toBeDefined();
    expect(first).toBe(second);

    scope.stop();
  });
});
