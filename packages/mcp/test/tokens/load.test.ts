import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { analyzeProject, type ProjectProfile } from '../../src/profile/profile.js';
import { loadProjectTokens, resolveTokenSource } from '../../src/tokens/load.js';

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

  it('recognises a config basename written with Windows separators', () => {
    // A tokenSource is a path the caller typed; on Windows it arrives backslashed, and matching only
    // `/` sent it to the fallback — reading a shared UnoCSS config with the Tailwind vocabulary,
    // which drops radius / text / shadow / tracking / leading / breakpoint / ease with skipped: 0.
    const tw = profileWith({ system: 'tailwind' });
    expect(resolveTokenSource(tw, 'packages\\ui\\uno.config.ts').source).toEqual({
      path: 'packages\\ui\\uno.config.ts',
      kind: 'unocss',
    });
    const uno = profileWith({ system: 'unocss' });
    expect(resolveTokenSource(uno, 'packages\\ui\\tailwind.config.js').source).toEqual({
      path: 'packages\\ui\\tailwind.config.js',
      kind: 'tailwind-v3',
    });
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

  it('falls back to the repo pool when the detected CSS entry declares nothing', async () => {
    // Tailwind v4's commonest layout: the entry holds `@import "tailwindcss"` and pulls the @theme
    // block in from a partial. The entry scan stops at the first file carrying either marker, so
    // reading only that file returned zero tokens — silently, with no note — for a project with a
    // complete design system.
    const dir = await mkdtemp(join(tmpdir(), 'load-split-'));
    try {
      await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({ devDependencies: { tailwindcss: '^4.0.0' } }),
      );
      await mkdir(join(dir, 'src'), { recursive: true });
      await writeFile(
        join(dir, 'src', 'app.css'),
        '@import "tailwindcss";\n@import "./theme.css";\n',
      );
      await writeFile(join(dir, 'src', 'theme.css'), '@theme { --color-primary-500: #6266F0; }');

      const profile = await analyzeProject(dir);
      expect(profile.styling.configPath).toBe('src/app.css'); // the entry, which declares nothing
      const loaded = await loadProjectTokens(dir, profile, undefined);
      const token = loaded.tokens.find(t => t.name === 'color-primary-500');
      expect(token?.value).toBe('#6266F0');
      // Still inside @theme in its own file, so the utility is still a real class.
      expect(token?.utilityIsClass).toBe(true);
      expect(loaded.note).toMatch(/declares no custom properties/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('keeps reading the detected entry when it does declare tokens', async () => {
    // The fallback must not fire for a project whose entry is the real token source — pooling there
    // would put incidental vars into a pool that is currently precise.
    const dir = await mkdtemp(join(tmpdir(), 'load-entry-'));
    try {
      await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({ devDependencies: { tailwindcss: '^4.0.0' } }),
      );
      await mkdir(join(dir, 'src'), { recursive: true });
      await writeFile(
        join(dir, 'src', 'app.css'),
        '@import "tailwindcss";\n@theme { --color-primary-500: #6266F0; }',
      );
      await writeFile(join(dir, 'src', 'misc.css'), ':root { --header-height: 64px; }');

      const loaded = await loadProjectTokens(dir, await analyzeProject(dir), undefined);
      expect(loaded.source).toBe('src/app.css');
      expect(loaded.tokens.map(t => t.name)).toEqual(['color-primary-500']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('keeps the utility ref on a real v4 @theme when the project also has a JS config', async () => {
    // `@config "../tailwind.config.js"` beside `@import "tailwindcss"` is v4's documented upgrade
    // path, so a genuine v4 project can have a root tailwind.config.* — which routes it to the
    // JS-config reader. Stripping @theme provenance by source kind therefore killed the utility ref
    // on every such project's real tokens, a regression against reading the CSS directly.
    const dir = await mkdtemp(join(tmpdir(), 'load-v4config-'));
    try {
      await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({
          devDependencies: { tailwindcss: '^4.1.0', '@tailwindcss/vite': '^4.0.0' },
        }),
      );
      await writeFile(
        join(dir, 'tailwind.config.js'),
        "module.exports = { content: ['./src/**/*.tsx'] };",
      );
      await mkdir(join(dir, 'src'), { recursive: true });
      await writeFile(
        join(dir, 'src', 'app.css'),
        '@import "tailwindcss";\n@config "../tailwind.config.js";\n@theme { --color-primary-500: #6266F0; }\n',
      );

      const profile = await analyzeProject(dir);
      expect(profile.styling.tailwindVersion).toBe(4);
      const loaded = await loadProjectTokens(dir, profile, undefined);
      const token = loaded.tokens.find(t => t.name === 'color-primary-500');
      expect(token?.utilityIsClass).toBe(true);
      // …and the note must not claim the opposite of what the payload contains.
      expect(loaded.note).not.toMatch(/declares no CSS custom properties/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('does not let a foreign @theme block claim to generate a class', async () => {
    // The CSS reader marks a declaration inside `@theme` as utility-generating, which is true of
    // Tailwind v4 and of nothing else. A repo migrated from v4 to UnoCSS (or to v3) can still carry
    // such a block, and pooling it kept the flag — so `--color-leftover` was offered to codegen as
    // `leftover`, i.e. `bg-leftover`, which neither framework compiles.
    for (const [configName, config, dep] of [
      [
        'uno.config.ts',
        "import { defineConfig, presetUno } from 'unocss'\nexport default defineConfig({ presets: [presetUno()], theme: { colors: { brand: '#111111' } } })",
        { unocss: '^66.0.0' },
      ],
      [
        'tailwind.config.js',
        "module.exports = { theme: { colors: { brand: '#111111' } } };",
        { tailwindcss: '^3.4.0' },
      ],
    ] as const) {
      const dir = await mkdtemp(join(tmpdir(), 'load-residue-'));
      try {
        await writeFile(join(dir, 'package.json'), JSON.stringify({ devDependencies: dep }));
        await writeFile(join(dir, configName), config);
        await mkdir(join(dir, 'src'), { recursive: true });
        await writeFile(join(dir, 'src', 'legacy.css'), '@theme { --color-leftover: #6266F0; }');

        const loaded = await loadProjectTokens(dir, await analyzeProject(dir), undefined);
        const byName = new Map(loaded.tokens.map(t => [t.name, t]));
        // The config's own scale still generates a class…
        expect(byName.get('color-brand')?.utilityIsClass).toBe(true);
        // …the foreign one does not, so it falls back to its var() reference.
        expect(byName.get('color-leftover')?.utilityIsClass).toBeUndefined();
        expect(byName.get('color-leftover')?.cssVar).toBe('var(--color-leftover)');
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
  });

  it('caps the file list in a note instead of naming up to 200 paths', async () => {
    // A note is a diagnostic; naming every contributor buries the sentence that matters under a
    // wall of paths in the middle of a tool result.
    const many = await mkdtemp(join(tmpdir(), 'load-many-'));
    try {
      await writeFile(join(many, 'package.json'), '{}');
      await mkdir(join(many, 'src'), { recursive: true });
      for (let i = 0; i < 9; i += 1) {
        await writeFile(join(many, 'src', `t${i}.css`), `:root { --c${i}: #00000${i}; }`);
      }
      const loaded = await loadProjectTokens(many, await analyzeProject(many), undefined);
      expect(loaded.note).toMatch(/\(\+3 more\)/);
      // The full list is still available structurally, for cache invalidation and callers.
      expect(loaded.files).toHaveLength(9);
    } finally {
      await rm(many, { recursive: true, force: true });
    }
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
