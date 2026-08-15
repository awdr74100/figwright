import { describe, expect, it } from 'vitest';

import type { ProjectProfile } from '../../src/profile/profile.js';
import { resolveTokenSource } from '../../src/tokens/load.js';

/** A profile carrying only what resolveTokenSource reads. */
const profileWith = (
  styling: Partial<ProjectProfile['styling']>,
): Pick<ProjectProfile, 'styling'> => ({
  styling: { system: 'unknown', ...styling },
});

describe('resolveTokenSource', () => {
  it('reads a detected CSS config as CSS', () => {
    expect(
      resolveTokenSource(profileWith({ system: 'tailwind', configPath: 'src/app.css' }), undefined),
    ).toEqual({ source: { path: 'src/app.css', kind: 'css' } });
  });

  it('reads a detected Tailwind config as a config, whatever extension it uses', () => {
    for (const path of [
      'tailwind.config.js',
      'tailwind.config.cjs',
      'tailwind.config.mjs',
      'tailwind.config.ts',
    ]) {
      expect(
        resolveTokenSource(profileWith({ system: 'tailwind', configPath: path }), undefined),
      ).toEqual({ source: { path, kind: 'tailwind-v3' } });
    }
  });

  it('picks the reader for an override from its extension, not from detection', () => {
    // The override exists to correct detection, so it must not inherit the detected kind: pointing
    // a v4 project at a config file reads a config, and a v3 project at a stylesheet reads CSS.
    const v4 = profileWith({ system: 'tailwind', configPath: 'src/app.css' });
    expect(resolveTokenSource(v4, 'tailwind.config.ts').source).toEqual({
      path: 'tailwind.config.ts',
      kind: 'tailwind-v3',
    });
    const v3 = profileWith({ system: 'tailwind', configPath: 'tailwind.config.js' });
    expect(resolveTokenSource(v3, 'styles/tokens.css').source).toEqual({
      path: 'styles/tokens.css',
      kind: 'css',
    });
  });

  it('asks for a tokenSource when nothing was detected', () => {
    const { source, note } = resolveTokenSource(profileWith({}), undefined);
    expect(source).toBeNull();
    expect(note).toMatch(/tokenSource/);
  });

  it('declines a detected config in a form it has no reader for', () => {
    const { source, note } = resolveTokenSource(
      profileWith({ system: 'scss', configPath: 'src/tokens.scss' }),
      undefined,
    );
    expect(source).toBeNull();
    expect(note).toMatch(/src\/tokens\.scss/);
  });
});
