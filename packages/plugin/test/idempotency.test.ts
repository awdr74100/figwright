import { describe, expect, it, vi } from 'vitest';

import { createIdempotencyCache, idempotent } from '../src/idempotency.js';

describe('createIdempotencyCache', () => {
  it('runs once per requestId and replays the cached result', async () => {
    const cache = createIdempotencyCache();
    const fn = vi.fn<() => Promise<{ token: number }>>(async () => ({ token: Math.random() }));
    const first = await cache.run('req-1', fn);
    const second = await cache.run('req-1', fn);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('runs separately for different requestIds', async () => {
    const cache = createIdempotencyCache();
    const fn = vi.fn<() => Promise<number>>(async () => 1);
    await cache.run('a', fn);
    await cache.run('b', fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('never dedupes when requestId is undefined', async () => {
    const cache = createIdempotencyCache();
    const fn = vi.fn<() => Promise<number>>(async () => 1);
    await cache.run(undefined, fn);
    await cache.run(undefined, fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('re-runs after the TTL expires and prunes stale entries', async () => {
    let clock = 1000;
    const cache = createIdempotencyCache(100, () => clock);
    const fn = vi.fn<() => Promise<number>>(async () => 1);
    await cache.run('x', fn);
    clock += 50;
    await cache.run('x', fn); // within TTL → cached
    expect(fn).toHaveBeenCalledTimes(1);
    clock += 100; // past TTL
    await cache.run('x', fn); // expired → re-run
    expect(fn).toHaveBeenCalledTimes(2);
    expect(cache.size()).toBe(1);
  });
});

describe('idempotent wrapper', () => {
  it('applies a write once across 5 repeated calls with the same requestId', async () => {
    const cache = createIdempotencyCache();
    const applied = vi.fn<() => Promise<{ ok: boolean }>>(async () => ({ ok: true }));
    const handler = idempotent(cache, applied);
    const results: unknown[] = [];
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- sequential by design (simulating retries)
      results.push(await handler({ requestId: 'w-1', nodeId: '1:2' }));
    }
    expect(applied).toHaveBeenCalledTimes(1);
    expect(results.every(r => r === results[0])).toBe(true);
  });

  it('runs every call when no requestId is present', async () => {
    const cache = createIdempotencyCache();
    const applied = vi.fn<() => Promise<number>>(async () => 1);
    const handler = idempotent(cache, applied);
    await handler({ nodeId: '1:2' });
    await handler({ nodeId: '1:2' });
    expect(applied).toHaveBeenCalledTimes(2);
  });
});
