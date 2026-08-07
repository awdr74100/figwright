import { EventEmitter } from 'node:events';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_HARD_EXIT_DELAY_MS, wireShutdown } from '../src/lifecycle.js';

describe('wireShutdown', () => {
  it.each([
    ['proc', 'SIGINT'],
    ['proc', 'SIGTERM'],
    ['stdin', 'end'],
    ['stdin', 'close'],
  ] as const)('runs shutdown when %s emits %s', (source, event) => {
    const proc = new EventEmitter();
    const stdin = new EventEmitter();
    let calls = 0;
    wireShutdown({ proc, stdin, shutdown: () => void calls++ });

    (source === 'proc' ? proc : stdin).emit(event);
    expect(calls).toBe(1);
  });

  it('runs shutdown at most once across multiple triggers', () => {
    const proc = new EventEmitter();
    const stdin = new EventEmitter();
    let calls = 0;
    wireShutdown({ proc, stdin, shutdown: () => void calls++ });

    stdin.emit('end');
    stdin.emit('close');
    proc.emit('SIGTERM');
    proc.emit('SIGINT');
    expect(calls).toBe(1);
  });

  it('does not run shutdown until a trigger fires', () => {
    const proc = new EventEmitter();
    const stdin = new EventEmitter();
    let calls = 0;
    wireShutdown({ proc, stdin, shutdown: () => void calls++ });

    expect(calls).toBe(0);
  });

  it('returns a trigger for losses that stdin never reports', () => {
    // A transport that dies on its own detaches from stdin without ending it, so none of the wired
    // events fire. The caller needs a way in — otherwise the process survives deaf, still holding
    // the relay port, which is the exact zombie this module exists to prevent.
    const proc = new EventEmitter();
    const stdin = new EventEmitter();
    let calls = 0;
    const trigger = wireShutdown({ proc, stdin, shutdown: () => void calls++ });

    trigger();
    expect(calls).toBe(1);
  });

  it('shares one guard between the returned trigger and the wired events', () => {
    // Shutdown closes the transport, which reports its close, which calls the trigger. That must
    // not start a second shutdown on top of the one already running.
    const proc = new EventEmitter();
    const stdin = new EventEmitter();
    let calls = 0;
    const trigger = wireShutdown({ proc, stdin, shutdown: () => void calls++ });

    stdin.emit('end');
    trigger();
    trigger();
    proc.emit('SIGTERM');
    expect(calls).toBe(1);
  });

  it('arms the hardExit backstop when the trigger is what fired', () => {
    vi.useFakeTimers();
    const proc = new EventEmitter();
    const stdin = new EventEmitter();
    const hardExit = vi.fn<() => void>();
    const trigger = wireShutdown({
      proc,
      stdin,
      shutdown: () => new Promise<void>(() => {}),
      hardExit,
    });

    trigger();
    vi.advanceTimersByTime(DEFAULT_HARD_EXIT_DELAY_MS);
    expect(hardExit).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

describe('wireShutdown hardExit backstop', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('invokes hardExit when the graceful shutdown has not exited after the delay', () => {
    vi.useFakeTimers();
    const proc = new EventEmitter();
    const stdin = new EventEmitter();
    const hardExit = vi.fn<() => void>();
    // A shutdown that stalls forever (e.g. a close waiting on connections that never drain).
    wireShutdown({ proc, stdin, shutdown: () => new Promise<void>(() => {}), hardExit });

    stdin.emit('end');
    expect(hardExit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(DEFAULT_HARD_EXIT_DELAY_MS);
    expect(hardExit).toHaveBeenCalledTimes(1);
  });

  it('respects a custom hardExitDelayMs', () => {
    vi.useFakeTimers();
    const proc = new EventEmitter();
    const stdin = new EventEmitter();
    const hardExit = vi.fn<() => void>();
    wireShutdown({
      proc,
      stdin,
      shutdown: () => new Promise<void>(() => {}),
      hardExit,
      hardExitDelayMs: 1_000,
    });

    proc.emit('SIGTERM');
    vi.advanceTimersByTime(999);
    expect(hardExit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(hardExit).toHaveBeenCalledTimes(1);
  });

  it('does not arm the backstop before a trigger fires', () => {
    vi.useFakeTimers();
    const proc = new EventEmitter();
    const stdin = new EventEmitter();
    const hardExit = vi.fn<() => void>();
    wireShutdown({ proc, stdin, shutdown: () => {}, hardExit });

    vi.advanceTimersByTime(DEFAULT_HARD_EXIT_DELAY_MS * 2);
    expect(hardExit).not.toHaveBeenCalled();
  });

  it('arms the backstop only once across multiple triggers', () => {
    vi.useFakeTimers();
    const proc = new EventEmitter();
    const stdin = new EventEmitter();
    const hardExit = vi.fn<() => void>();
    wireShutdown({ proc, stdin, shutdown: () => new Promise<void>(() => {}), hardExit });

    stdin.emit('end');
    stdin.emit('close');
    proc.emit('SIGTERM');
    vi.advanceTimersByTime(DEFAULT_HARD_EXIT_DELAY_MS * 2);
    expect(hardExit).toHaveBeenCalledTimes(1);
  });
});
