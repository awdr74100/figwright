import { createSharedComposable, useNow } from '@vueuse/core';

/**
 * One ticking clock for the whole panel.
 *
 * Several components render relative times (activity rows, connection uptime, recent errors). Each
 * calling `useNow` directly would start its own interval; `createSharedComposable` gives them all
 * the same source and tears the interval down once the last consumer unmounts.
 */
export const useSharedNow = createSharedComposable(() => useNow({ interval: 1000 }));
