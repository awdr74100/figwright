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

  it('reads a detected UnoCSS config with the UnoCSS reader', () => {
    expect(
      resolveTokenSource(profileWith({ system: 'unocss', configPath: 'uno.config.ts' }), undefined),
    ).toEqual({ source: { path: 'uno.config.ts', kind: 'unocss' } });
  });

  it('recognises both UnoCSS config basenames in an override', () => {
    // `uno.config.*` is the commoner of the two and was the one a too-clever `unocss?` pattern
    // missed — it means "unocs" + an optional "s", so it matched a name nobody writes.
    const tw = profileWith({ system: 'tailwind', configPath: 'tailwind.config.ts' });
    for (const path of [
      'uno.config.ts',
      'unocss.config.ts',
      'uno.config.mjs',
      'app/uno.config.ts',
    ]) {
      expect(resolveTokenSource(tw, path).source).toEqual({ path, kind: 'unocss' });
    }
  });

  it('recognises a Tailwind config basename in an override even on an UnoCSS project', () => {
    // A monorepo whose app is UnoCSS can still keep its tokens in a shared package's Tailwind
    // config. Reading that with the UnoCSS vocabulary drops screens / transitionTimingFunction /
    // aspectRatio / animation while hunting for breakpoints and easing, which aren't there.
    expect(
      resolveTokenSource(profileWith({ system: 'unocss' }), 'packages/ui/tailwind.config.js')
        .source,
    ).toEqual({ path: 'packages/ui/tailwind.config.js', kind: 'tailwind-v3' });
  });

  it('falls back to the detected framework for a JS override whose name says nothing', () => {
    // An override usually corrects *where* the tokens live, not which framework wrote them.
    expect(resolveTokenSource(profileWith({ system: 'unocss' }), 'config/theme.ts').source).toEqual(
      { path: 'config/theme.ts', kind: 'unocss' },
    );
    expect(
      resolveTokenSource(profileWith({ system: 'tailwind' }), 'config/theme.ts').source,
    ).toEqual({ path: 'config/theme.ts', kind: 'tailwind-v3' });
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
