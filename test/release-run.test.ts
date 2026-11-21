import { beforeEach, describe, expect, it, vi } from 'vitest';

// Which command runPnpm hands spawnSync for each way pnpm can be installed — the part a real start
// on one machine covers only one branch of.
const spawnSync = vi.fn<(command: string, args: string[], options: object) => { status: number }>(
  () => ({ status: 0 }),
);
vi.mock('node:child_process', () => ({ spawnSync }));

const { runPnpm } = await import('../scripts/release-checks.mjs');

describe('runPnpm picks how to start pnpm', () => {
  beforeEach(() => spawnSync.mockClear());

  it('runs pnpm’s JS entry (npm / corepack install) on this Node.js', () => {
    runPnpm(['test'], '/repo', { npm_execpath: '/x/node_modules/pnpm/bin/pnpm.cjs' });
    expect(spawnSync).toHaveBeenCalledWith(
      process.execPath,
      ['/x/node_modules/pnpm/bin/pnpm.cjs', 'test'],
      { cwd: '/repo', stdio: 'inherit' },
    );
  });

  it('runs a standalone pnpm binary as is, pnpm.exe on Windows included', () => {
    for (const binary of ['/x/node_modules/pnpm/pnpm', 'C:\\Users\\a\\pnpm\\pnpm.exe']) {
      spawnSync.mockClear();
      runPnpm(['build'], '/repo', { npm_execpath: binary });
      expect(spawnSync).toHaveBeenCalledWith(binary, ['build'], { cwd: '/repo', stdio: 'inherit' });
    }
  });

  it('does not hand pnpm’s args to npm, even installed under a pnpm folder', () => {
    for (const npm of [
      '/usr/lib/node_modules/npm/bin/npm-cli.js',
      '/Users/a/Library/pnpm/global/node_modules/npm/bin/npm-cli.js',
    ]) {
      spawnSync.mockClear();
      runPnpm(['test'], '/repo', { npm_execpath: npm });
      expect(spawnSync.mock.calls[0]?.[0]).toBe('pnpm');
    }
  });

  it('looks pnpm up on PATH without npm_execpath, through a shell on Windows only', () => {
    runPnpm(['test'], '/repo', {});
    expect(spawnSync).toHaveBeenCalledWith('pnpm', ['test'], {
      cwd: '/repo',
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
  });
});
