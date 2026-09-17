import { createSharedComposable, useIntervalFn, useNow } from '@vueuse/core';

/**
 * One ticking clock for the whole panel.
 *
 * Several components render relative times (activity rows, connection uptime, recent errors). Each
 * calling `useNow` directly would start its own interval; `createSharedComposable` gives them all
 * the same source and tears the interval down once the last consumer unmounts.
 *
 * The scheduler is spelled out because `useNow`'s own default is `useRafFn`: left to itself it
 * rebuilds a `Date` every animation frame to feed text that changes once a second. Handing it an
 * interval is the whole reason this file exists alongside `createSharedComposable`, so it is not an
 * option to drop. (VueUse 14 wrote the same thing as `{ interval: 1000 }`; v15 removed that shim in
 * favour of the scheduler it had been building underneath all along.)
 */
export const useSharedNow = createSharedComposable(() =>
  useNow({ scheduler: cb => useIntervalFn(cb, 1000) }),
);
