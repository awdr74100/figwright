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

  it('reads a SCSS project, which previously joined against an empty pool', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'load-scss-'));
    try {
      await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({ devDependencies: { sass: '^1.102.0' } }),
      );
      await mkdir(join(dir, 'src', 'styles'), { recursive: true });
      await writeFile(
        join(dir, 'src', 'styles', '_tokens.scss'),
        [
          '$color-primary-500: #6266F0;',
          '$radius-lg: 8px !default;',
          // A CSS custom property written in a .scss file compiles through untouched, so it is an
          // ordinary var() token — modern SCSS projects use both and reading one leaves half unread.
          ':root { --color-legacy: #1F304D; }',
          // Scoped to a rule: not referenceable from generated code.
          '.card { $scoped: 99px; padding: $scoped; }',
        ].join('\n'),
      );

      const profile = await analyzeProject(dir);
      expect(profile.styling.system).toBe('scss');
      const loaded = await loadProjectTokens(dir, profile, undefined);
      const byName = new Map(loaded.tokens.map(t => [t.name, t]));

      expect(byName.get('color-primary-500')).toMatchObject({
        scssVar: '$color-primary-500',
        from: 'src/styles/_tokens.scss',
      });
      expect(byName.get('radius-lg')?.value).toBe('8px');
      expect(byName.get('color-legacy')?.cssVar).toBe('var(--color-legacy)');
      expect(byName.has('scoped')).toBe(false);
      // The ref is not self-sufficient, so every SCSS result says what makes it resolve.
      expect(loaded.note).toMatch(/@use/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("pools a SCSS project's .css alongside its .scss", async () => {
    // Symmetric with the JS-config path: a project can keep Sass variables in .scss and a global
    // :root block in a plain .css file, and returning only one trades half the matches away.
    const dir = await mkdtemp(join(tmpdir(), 'load-scss-css-'));
    try {
      await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({ devDependencies: { sass: '^1' } }),
      );
      await mkdir(join(dir, 'src'), { recursive: true });
      await writeFile(join(dir, 'src', '_tokens.scss'), '$color-primary-500: #6266F0;');
      await writeFile(join(dir, 'src', 'global.css'), ':root { --color-legacy: #1F304D; }');

      const loaded = await loadProjectTokens(dir, await analyzeProject(dir), undefined);
      const byName = new Map(loaded.tokens.map(t => [t.name, t]));
      expect(byName.get('color-primary-500')?.scssVar).toBe('$color-primary-500');
      expect(byName.get('color-legacy')?.cssVar).toBe('var(--color-legacy)');
      expect(loaded.files).toEqual(['src/_tokens.scss', 'src/global.css']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('collapses a mirror split across two files, not just within one', async () => {
    // `_vars.scss` for the build-time Sass variables plus a hand-written `global.css` `:root` block
    // for runtime theming, same palette, is a standard layout. Keeping both halves cost such a
    // project twice: an exact hit degraded to 'medium' because the join saw two same-value tokens,
    // and the surviving ref flipped to `$primary`, which needs an `@use` — where reading only the
    // CSS (this server's behaviour before SCSS was a source at all) returned `var(--primary)` at
    // full confidence. A regression against our own previous output.
    const dir = await mkdtemp(join(tmpdir(), 'load-xfile-'));
    try {
      await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({ devDependencies: { sass: '^1' } }),
      );
      await mkdir(join(dir, 'src'), { recursive: true });
      await writeFile(join(dir, 'src', '_vars.scss'), '$primary: #6266F0;');
      await writeFile(join(dir, 'src', 'global.css'), ':root { --primary: #6266F0; }');

      const loaded = await loadProjectTokens(dir, await analyzeProject(dir), undefined);
      expect(loaded.tokens).toHaveLength(1);
      expect(loaded.tokens[0]?.cssVar).toBe('var(--primary)');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('does not attach the @use instruction to a pool that needs no import', async () => {
    // The sentence is model-facing guidance and only applies to a token carrying a declaring file.
    // Said over plain custom properties it told the caller to import something for a `var()` that
    // needs nothing — a fabricated instruction, in the file the model then writes.
    const dir = await mkdtemp(join(tmpdir(), 'load-nouse-'));
    try {
      await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({ devDependencies: { sass: '^1' } }),
      );
      await mkdir(join(dir, 'src'), { recursive: true });
      await writeFile(join(dir, 'src', 'g.css'), ':root { --a: 1px; }');

      const loaded = await loadProjectTokens(dir, await analyzeProject(dir), undefined);
      expect(loaded.note).not.toMatch(/@use/);
      // …and it does not claim a .scss pool it never found.
      expect(loaded.note).not.toMatch(/0 \.scss/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reports a refused override even when nothing else was found', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'load-onlysass-'));
    try {
      await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({ devDependencies: { sass: '^1' } }),
      );
      await mkdir(join(dir, 'src'), { recursive: true });
      await writeFile(join(dir, 'src', '_v.sass'), '$a: 1px');

      const loaded = await loadProjectTokens(dir, await analyzeProject(dir), 'src/_v.sass');
      expect(loaded.tokens).toEqual([]);
      expect(loaded.note).toMatch(/indented \.sass syntax/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('collapses the mirror layout into one token with the import-free ref', async () => {
    // `$brand` plus `:root { --brand: #{$brand} }` in one file is one logical token with two
    // reference forms — the idiomatic modern layout this reader set out to support. Left as two,
    // an exact name+value hit degraded to 'medium' and reported the token ambiguous with itself.
    // The custom property wins because var(--brand) compiles from any consumer with no @use at all.
    const dir = await mkdtemp(join(tmpdir(), 'load-mirror-'));
    try {
      await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({ devDependencies: { sass: '^1' } }),
      );
      await mkdir(join(dir, 'src'), { recursive: true });
      await writeFile(
        join(dir, 'src', '_tokens.scss'),
        '$brand: #6266F0;\n$only-scss: #FF0000;\n:root { --brand: #6266F0; }',
      );

      const loaded = await loadProjectTokens(dir, await analyzeProject(dir), undefined);
      const byName = new Map(loaded.tokens.map(t => [t.name, t]));
      expect(loaded.tokens.filter(t => t.name === 'brand')).toHaveLength(1);
      expect(byName.get('brand')?.cssVar).toBe('var(--brand)');
      expect(byName.get('brand')?.scssVar).toBeUndefined();
      // A variable with no mirror keeps its own ref and declaring file.
      expect(byName.get('only-scss')?.scssVar).toBe('$only-scss');
      expect(byName.get('only-scss')?.from).toBe('src/_tokens.scss');
      // The note counts what the result contains, not the raw walks.
      expect(loaded.note).toMatch(/aggregated 2 token\(s\)/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('collapses the mirror on the explicit tokenSource path too', async () => {
    // More likely to matter here than on the aggregate path: a caller narrows tokenSource to the
    // file that declares the tokens, which is exactly the file that carries the mirror.
    const dir = await mkdtemp(join(tmpdir(), 'load-mirror-one-'));
    try {
      await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({ devDependencies: { sass: '^1' } }),
      );
      await mkdir(join(dir, 'src'), { recursive: true });
      await writeFile(join(dir, 'src', '_t.scss'), '$brand: #6266F0;\n:root { --brand: #6266F0; }');
      const loaded = await loadProjectTokens(dir, await analyzeProject(dir), 'src/_t.scss');
      expect(loaded.tokens).toHaveLength(1);
      expect(loaded.tokens[0]?.cssVar).toBe('var(--brand)');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('keeps a mirror whose two forms hold different values', async () => {
    // Not a mirror of one token but two real declarations — the value-match join needs both.
    const dir = await mkdtemp(join(tmpdir(), 'load-mirror-diff-'));
    try {
      await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({ devDependencies: { sass: '^1' } }),
      );
      await mkdir(join(dir, 'src'), { recursive: true });
      await writeFile(join(dir, 'src', '_t.scss'), '$brand: #6266F0;\n:root { --brand: #FF0000; }');
      const loaded = await loadProjectTokens(dir, await analyzeProject(dir), undefined);
      expect(loaded.tokens.map(t => t.value).toSorted()).toEqual(['#6266F0', '#FF0000']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('falls back when an explicitly named .scss declares nothing itself', async () => {
    // SCSS's commonest entry shape is a barrel: `main.scss` = `@use './tokens'; @use './mixins';`.
    // Reading only the named file returned an empty pool under a note that never said so, leaving
    // every Figma variable unmapped while omitting tokenSource entirely would have worked.
    const dir = await mkdtemp(join(tmpdir(), 'load-barrel-'));
    try {
      await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({ devDependencies: { sass: '^1' } }),
      );
      await mkdir(join(dir, 'src', 'styles'), { recursive: true });
      await writeFile(join(dir, 'src', 'styles', '_tokens.scss'), '$brand: #6266F0;');
      await writeFile(join(dir, 'src', 'styles', 'main.scss'), "@use './tokens';");

      const loaded = await loadProjectTokens(
        dir,
        await analyzeProject(dir),
        'src/styles/main.scss',
      );
      expect(loaded.tokens.map(t => t.name)).toEqual(['brand']);
      expect(loaded.note).toMatch(/declares no tokens of its own/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('does not tell a SCSS project that no token source was detected', async () => {
    // `resolveTokenSource` says "no token source detected; pass tokenSource" for any project with no
    // config file — true of every SCSS project, since there is no such thing to detect. Forwarded
    // into the pool's own note it produced a sentence contradicting itself in its second clause:
    // "no token source detected; pass tokenSource; aggregated 1192 token(s) from 22 .scss file(s)".
    const dir = await mkdtemp(join(tmpdir(), 'load-note-'));
    try {
      await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({ devDependencies: { sass: '^1' } }),
      );
      await mkdir(join(dir, 'src'), { recursive: true });
      await writeFile(join(dir, 'src', '_t.scss'), '$brand: #6266F0;');

      const loaded = await loadProjectTokens(dir, await analyzeProject(dir), undefined);
      expect(loaded.tokens).toHaveLength(1);
      expect(loaded.note).not.toMatch(/no token source detected/);
      expect(loaded.note).toMatch(/^aggregated 1 token/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('carries a refused override into the note of whatever it fell back to', async () => {
    // The refusal was computed and then dropped whenever a pool was found — which is every real
    // repo — so the answer described files the caller never asked about with no hint of a refusal.
    const dir = await mkdtemp(join(tmpdir(), 'load-sassnote-'));
    try {
      await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({ devDependencies: { sass: '^1' } }),
      );
      await mkdir(join(dir, 'src'), { recursive: true });
      await writeFile(join(dir, 'src', '_v.sass'), '$a: 1px');
      await writeFile(join(dir, 'src', '_t.scss'), '$brand: #6266F0;');

      const loaded = await loadProjectTokens(dir, await analyzeProject(dir), 'src/_v.sass');
      expect(loaded.note).toMatch(/indented \.sass syntax/);
      expect(loaded.tokens.map(t => t.name)).toEqual(['brand']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('refuses a .sass override instead of silently reading nothing', () => {
    // The indented syntax is newline-terminated, which the value reader would run past — so the
    // walk never visits it. Pointed at one explicitly, saying so beats returning an empty pool
    // under a note that never mentions the file the caller asked for.
    const { source, refusal } = resolveTokenSource(profileWith({ system: 'scss' }), 'src/_v.sass');
    expect(source).toBeNull();
    // A refusal of what the caller asked for, distinct from the ordinary "nothing detected" note —
    // only the refusal survives into whatever the loader falls back to.
    expect(refusal).toMatch(/indented \.sass syntax/);
  });

  it('does not report a token ambiguous with itself when both walks see it', async () => {
    // A `:root` block in a .scss file and the compiled .css committed beside it are one
    // declaration read through two walks. Left duplicated, an exact name+value hit degrades to
    // 'medium' with ambiguousWith naming the token itself.
    const dir = await mkdtemp(join(tmpdir(), 'load-dup-'));
    try {
      await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({ devDependencies: { sass: '^1' } }),
      );
      await mkdir(join(dir, 'src'), { recursive: true });
      await writeFile(join(dir, 'src', '_t.scss'), ':root { --brand: #6266F0; }');
      await writeFile(join(dir, 'src', 'compiled.css'), ':root { --brand: #6266F0; }');

      const loaded = await loadProjectTokens(dir, await analyzeProject(dir), undefined);
      expect(loaded.tokens.filter(t => t.name === 'brand')).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reads a single .scss file when tokenSource names one', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'load-scss-one-'));
    try {
      await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({ devDependencies: { sass: '^1' } }),
      );
      await mkdir(join(dir, 'src'), { recursive: true });
      await writeFile(join(dir, 'src', '_a.scss'), '$from-a: #111111;');
      await writeFile(join(dir, 'src', '_b.scss'), '$from-b: #222222;');

      const loaded = await loadProjectTokens(dir, await analyzeProject(dir), 'src/_a.scss');
      expect(loaded.source).toBe('src/_a.scss');
      expect(loaded.tokens.map(t => t.name)).toEqual(['from-a']);
      expect(loaded.tokens[0]?.from).toBe('src/_a.scss');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('names the generated stylesheet when a token build tool wrote it somewhere pruned', async () => {
    // Style Dictionary's own basic example uses `buildPath: "build/"`, which every walk here prunes
    // as a build artefact — so a project that generates its tokens and commits them gets an empty
    // pool under "no token source detected", which is true and useless. This note is read by an
    // agent that can act on it, so it names the tool and the file to pass as tokenSource.
    const dir = await mkdtemp(join(tmpdir(), 'load-generated-'));
    try {
      await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({ devDependencies: { 'style-dictionary': '^5.5.1' } }),
      );
      await mkdir(join(dir, 'build'), { recursive: true });
      await writeFile(join(dir, 'build', 'variables.css'), ':root { --brand: #6266F0; }');

      const profile = await analyzeProject(dir);
      const loaded = await loadProjectTokens(dir, profile, undefined);
      expect(loaded.tokens).toEqual([]);
      expect(loaded.note).toMatch(/Style Dictionary/);
      expect(loaded.note).toContain('build/variables.css');

      // And the advice works: passing what the note names reads the tokens.
      const followed = await loadProjectTokens(dir, profile, 'build/variables.css');
      expect(followed.tokens.map(t => t.name)).toEqual(['brand']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('names the generated stylesheet even when other tokens were found', async () => {
    // The first version fired only on a completely empty pool — the clean-room shape. A Style
    // Dictionary project with one unrelated stylesheet anywhere returned that stylesheet's
    // incidental `--header-height` and said nothing about the design tokens in build/. Confidently
    // incomplete is worse than empty, because it looks like an answer.
    const dir = await mkdtemp(join(tmpdir(), 'load-partial-'));
    try {
      await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({ devDependencies: { 'style-dictionary': '^5.5.1' } }),
      );
      await mkdir(join(dir, 'build'), { recursive: true });
      await writeFile(join(dir, 'build', 'variables.css'), ':root { --color-primary: #6266F0; }');
      await mkdir(join(dir, 'src'), { recursive: true });
      await writeFile(join(dir, 'src', 'layout.css'), ':root { --header-height: 64px; }');

      const loaded = await loadProjectTokens(dir, await analyzeProject(dir), undefined);
      // The pool it did find is still returned, unchanged…
      expect(loaded.tokens.map(t => t.name)).toEqual(['header-height']);
      // …and the note now says what it missed, and that the answer may be partial.
      expect(loaded.note).toContain('src/layout.css');
      expect(loaded.note).toMatch(/Style Dictionary/);
      expect(loaded.note).toMatch(/may be incomplete/);
      expect(loaded.note).toContain('build/variables.css');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('says nothing when tokenSource already points at the generated stylesheet', async () => {
    // Telling a caller to pass what they just passed is noise, and this note is read by an agent
    // that may act on it.
    const dir = await mkdtemp(join(tmpdir(), 'load-pointed-'));
    try {
      await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({ devDependencies: { 'style-dictionary': '^5.5.1' } }),
      );
      await mkdir(join(dir, 'build'), { recursive: true });
      await writeFile(join(dir, 'build', 'variables.css'), ':root { --color-primary: #6266F0; }');

      const loaded = await loadProjectTokens(dir, await analyzeProject(dir), 'build/variables.css');
      expect(loaded.tokens.map(t => t.name)).toEqual(['color-primary']);
      expect(loaded.note).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('says nothing when the tool emits no stylesheet and tokens were found anyway', async () => {
    // A build tool configured for iOS/Android only has nothing this reader could use, so a project
    // whose web tokens are already in place should read exactly as it did before.
    const dir = await mkdtemp(join(tmpdir(), 'load-nonweb-'));
    try {
      await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({ devDependencies: { 'style-dictionary': '^5.5.1' } }),
      );
      await mkdir(join(dir, 'build', 'ios'), { recursive: true });
      await writeFile(join(dir, 'build', 'ios', 'Colors.swift'), '// generated');
      await mkdir(join(dir, 'src'), { recursive: true });
      await writeFile(join(dir, 'src', 'app.css'), ':root { --brand: #6266F0; }');

      const loaded = await loadProjectTokens(dir, await analyzeProject(dir), undefined);
      expect(loaded.tokens.map(t => t.name)).toEqual(['brand']);
      expect(loaded.note).not.toMatch(/Style Dictionary/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('says the build has not run when the tool is there but the output is not', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'load-nobuild-'));
    try {
      await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({ devDependencies: { '@tokens-studio/sd-transforms': '^1' } }),
      );
      await mkdir(join(dir, 'tokens'), { recursive: true });
      await writeFile(join(dir, 'tokens', 'color.json'), '{}');

      const loaded = await loadProjectTokens(dir, await analyzeProject(dir), undefined);
      expect(loaded.note).toMatch(/Tokens Studio/);
      expect(loaded.note).toMatch(/run its build|commit the generated stylesheet/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('keeps the plain note when no token build tool is involved', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'load-plain-'));
    try {
      await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({ dependencies: { react: '^18' } }),
      );
      const loaded = await loadProjectTokens(dir, await analyzeProject(dir), undefined);
      expect(loaded.note).toBe('no token source detected; pass tokenSource');
    } finally {
      await rm(dir, { recursive: true, force: true });
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
