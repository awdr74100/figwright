import { Console } from 'node:console';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { consoleToStderr, guardProcess, muteStreamErrors } from '../src/process-guard.js';

const fakeProcess = (): EventEmitter => new EventEmitter();

describe('guardProcess', () => {
  it('reports an uncaught exception and an unhandled rejection instead of ending the process', () => {
    const proc = fakeProcess();
    const written: string[] = [];
    guardProcess(proc, text => written.push(text));

    proc.emit('uncaughtException', new Error('boom'));
    proc.emit('unhandledRejection', 'plain reason');

    expect(written).toHaveLength(2);
    expect(written[0]).toMatch(/uncaught exception — kept running: Error: boom/);
    expect(written[1]).toMatch(/unhandled rejection — kept running: plain reason/);
  });

  it('drops a report whose own write fails, without raising', () => {
    const proc = fakeProcess();
    guardProcess(proc, () => {
      throw new Error('stderr is closed');
    });
    expect(() => proc.emit('uncaughtException', new Error('boom'))).not.toThrow();
  });

  it('does not recurse when reporting raises another error of its own', () => {
    const proc = fakeProcess();
    let writes = 0;
    guardProcess(proc, () => {
      writes += 1;
      // A write that synchronously ends up raising again must not loop back into a new report.
      proc.emit('uncaughtException', new Error('raised while reporting'));
    });
    proc.emit('uncaughtException', new Error('first'));
    expect(writes).toBe(1);
  });

  it('stops writing after a burst of reports, saying so once', () => {
    const proc = fakeProcess();
    const written: string[] = [];
    guardProcess(proc, text => written.push(text));
    for (let i = 0; i < 80; i += 1) proc.emit('unhandledRejection', new Error(`r${i}`));
    expect(written).toHaveLength(50);
    expect(written.at(-1)).toMatch(/further reports suppressed/);
  });
});

describe('muteStreamErrors', () => {
  it('keeps a failed stdio write from becoming an uncaught error', () => {
    const stream = new EventEmitter();
    muteStreamErrors(stream);
    expect(() => stream.emit('error', new Error('EPIPE'))).not.toThrow();
  });
});

describe('consoleToStderr', () => {
  it('sends every console method to the given stream', () => {
    const sink = new PassThrough();
    let captured = '';
    sink.on('data', (chunk: Buffer) => {
      captured += chunk.toString('utf8');
    });
    // A stand-in for the global console whose own stdout is a stream that must stay untouched.
    const stdout = new PassThrough();
    let leaked = '';
    stdout.on('data', (chunk: Buffer) => {
      leaked += chunk.toString('utf8');
    });
    const target = new Console({ stdout, stderr: sink });

    consoleToStderr(target, sink);
    target.log('from log');
    target.info('from info');
    target.table([{ a: 1 }]);

    expect(leaked).toBe('');
    expect(captured).toContain('from log');
    expect(captured).toContain('from info');
  });
});
