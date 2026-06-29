import { EventEmitter } from 'node:events';

import { describe, expect, it } from 'vitest';

import { wireShutdown } from '../src/lifecycle.js';

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
});
