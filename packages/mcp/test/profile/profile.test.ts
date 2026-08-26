import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  analyzeProject,
  detectProfile,
  gatherProjectInput,
  isUtilityFirst,
  readStylesheetNames,
  type ProjectInput,
  tallyClassNaming,
} from '../../src/profile/profile.js';

const baseInput = (over: Partial<ProjectInput> = {}): ProjectInput => ({
  rootDir: '/proj',
  packageJson: null,
  hasTsconfig: false,
  presentConfigFiles: [],
  ...over,
});

describe('detectProfile (pure)', () => {
  it('picks the meta-framework over the library it wraps (Next > React)', () => {
    const p = detectProfile(
      baseInput({ packageJson: { dependencies: { next: '^15.0.0', react: '^19.0.0' } } }),
    );
    expect(p.framework).toBe('next');
    expect(p.componentExtensions).toEqual(['.tsx', '.jsx']);
  });

  it('detects Nuxt over Vue and uses .vue extension', () => {
    const p = detectProfile(
      baseInput({ packageJson: { dependencies: { nuxt: '^3.0.0', vue: '^3.4.0' } } }),
    );
    expect(p.framework).toBe('nuxt');
    expect(p.componentExtensions).toEqual(['.vue']);
  });

  it('detects Solid from solid-js and scans its JSX extensions', () => {
    const p = detectProfile(baseInput({ packageJson: { dependencies: { 'solid-js': '^1.8.0' } } }));
    expect(p.framework).toBe('solid');
    // Solid JSX lives in .tsx/.jsx, parsed by the same extractor as React.
    expect(p.componentExtensions).toEqual(['.tsx', '.jsx']);
  });

  it('resolves the Solid svg loader to its component-solid import form', () => {
    const p = detectProfile(
      baseInput({
        packageJson: {
          dependencies: { 'solid-js': '^1.8.0' },
          devDependencies: { 'vite-plugin-solid-svg': '^0.8.0' },
        },
      }),
    );
    expect(p.svg.mode).toBe('component');
    expect(p.svg.importHint).toBe("import Icon from './icon.svg?component-solid'");
  });

  it('detects Angular from @angular/core and scans .ts components', () => {
    const p = detectProfile(
      baseInput({ packageJson: { dependencies: { '@angular/core': '^19.0.0' } } }),
    );
    expect(p.framework).toBe('angular');
    // Angular components are @Component classes in .ts (the scanner filters to @Component classes).
    expect(p.componentExtensions).toEqual(['.ts']);
  });

  it('flags ts when tsconfig present, js otherwise', () => {
    expect(detectProfile(baseInput({ hasTsconfig: true })).language).toBe('ts');
    expect(
      detectProfile(baseInput({ packageJson: { devDependencies: { typescript: '^5' } } })).language,
    ).toBe('ts');
    expect(detectProfile(baseInput()).language).toBe('js');
  });

  it('detects Tailwind v3 from a config file and reports version 3', () => {
    const p = detectProfile(
      baseInput({
        packageJson: { devDependencies: { tailwindcss: '^3.4.0' } },
        presentConfigFiles: ['tailwind.config.ts'],
      }),
    );
    expect(p.styling.system).toBe('tailwind');
    expect(p.styling.configPath).toBe('tailwind.config.ts');
    expect(p.styling.tailwindVersion).toBe(3);
  });

  it('detects Tailwind v4 CSS-first config (no JS config file) and points configPath at the CSS', () => {
    const p = detectProfile(
      baseInput({
        packageJson: { devDependencies: { tailwindcss: '^4.0.0', '@tailwindcss/vite': '^4.0.0' } },
        tailwindCssEntry: 'src/app.css',
      }),
    );
    expect(p.styling.system).toBe('tailwind');
    expect(p.styling.configPath).toBe('src/app.css');
    expect(p.styling.tailwindVersion).toBe(4);
  });

  it('detects Tailwind from the v4-only package even with no config located, defaulting to v4', () => {
    const p = detectProfile(
      baseInput({ packageJson: { devDependencies: { '@tailwindcss/postcss': '^4.0.0' } } }),
    );
    expect(p.styling.system).toBe('tailwind');
    expect(p.styling.tailwindVersion).toBe(4);
    expect(p.styling.configPath).toBeUndefined();
  });

  it('detects UnoCSS from its config file and points configPath at it', () => {
    const p = detectProfile(
      baseInput({
        packageJson: { devDependencies: { unocss: '^66.0.0' } },
        presentConfigFiles: ['uno.config.ts'],
      }),
    );
    expect(p.styling.system).toBe('unocss');
    expect(p.styling.configPath).toBe('uno.config.ts');
  });

  it('detects UnoCSS from a scoped package when no config file was located', () => {
    // The Nuxt and Vite integrations install only the pieces they use, so the umbrella `unocss`
    // package is not always present.
    const p = detectProfile(
      baseInput({ packageJson: { devDependencies: { '@unocss/nuxt': '^66.0.0' } } }),
    );
    expect(p.styling.system).toBe('unocss');
    expect(p.styling.configPath).toBeUndefined();
  });

  it('lets an UnoCSS config file beat a leftover Tailwind CSS marker', () => {
    // tailwindCssEntry is whichever file *anywhere* in the repo still contains `@import
    // "tailwindcss"` or `@theme` — in a half-migrated repo that is residue, while a root
    // uno.config.ts is a current statement of what builds the CSS.
    const p = detectProfile(
      baseInput({
        packageJson: { devDependencies: { unocss: '^66.0.0' } },
        presentConfigFiles: ['uno.config.ts'],
        tailwindCssEntry: 'src/legacy.css',
      }),
    );
    expect(p.styling.system).toBe('unocss');
    expect(p.styling.configPath).toBe('uno.config.ts');
  });

  it('still detects Tailwind v4 from its CSS marker when no root config file exists', () => {
    const p = detectProfile(
      baseInput({
        packageJson: { devDependencies: { tailwindcss: '^4.0.0' } },
        tailwindCssEntry: 'src/app.css',
      }),
    );
    expect(p.styling.system).toBe('tailwind');
    expect(p.styling.configPath).toBe('src/app.css');
    expect(p.styling.tailwindVersion).toBe(4);
  });

  it('keeps Tailwind v4 when its CSS marker is backed by a real dependency', () => {
    // "UnoCSS for icons alongside Tailwind v4" is a common layout, and v4 has no JS config by
    // design — so its only root-level evidence is the CSS marker. A marker backed by an actual
    // tailwindcss dependency is a live setup, not the migration residue the uno-first rule exists
    // for; letting the uno config win read the wrong token source.
    const p = detectProfile(
      baseInput({
        packageJson: { devDependencies: { tailwindcss: '^4.0.0', unocss: '^66.0.0' } },
        presentConfigFiles: ['uno.config.ts'],
        tailwindCssEntry: 'src/app.css',
      }),
    );
    expect(p.styling.system).toBe('tailwind');
    expect(p.styling.configPath).toBe('src/app.css');
    expect(p.styling.tailwindVersion).toBe(4);
  });

  it('does not treat an icons-only UnoCSS install as a utility-first project', () => {
    // presetIcons adds rules without a theme vocabulary. Counted as evidence, a plain-CSS project
    // became utility-first and codegen was told to write `p-4`, which nothing there generates.
    const p = detectProfile(
      baseInput({ packageJson: { devDependencies: { '@unocss/preset-icons': '^66.0.0' } } }),
    );
    expect(p.styling.system).toBe('unknown');
    expect(isUtilityFirst(p.styling.system)).toBe(false);
  });

  it('does not treat @unocss/reset as evidence of UnoCSS', () => {
    // It is a bundle of stylesheets (normalize / eric-meyer / a Tailwind-compat reset) any project
    // can import without UnoCSS generating a class. Counting it flipped a plain-CSS project to
    // utility-first, whose refs and framework-builtin rows would name classes that don't exist.
    const p = detectProfile(
      baseInput({ packageJson: { devDependencies: { '@unocss/reset': '^66.0.0' } } }),
    );
    expect(p.styling.system).toBe('unknown');
  });

  it('lets an UnoCSS config file beat a bare tailwindcss dependency', () => {
    // `tailwindcss` turns up in UnoCSS repos for prettier-plugin-tailwindcss, editor tooling, or a
    // half-finished migration. Letting that dep-only branch run first called the project Tailwind
    // *and* reported no configPath, so the uno.config.ts at the root was never read as a source.
    const p = detectProfile(
      baseInput({
        packageJson: { devDependencies: { tailwindcss: '^3.4.0', unocss: '^66.0.0' } },
        presentConfigFiles: ['uno.config.ts'],
      }),
    );
    expect(p.styling.system).toBe('unocss');
    expect(p.styling.configPath).toBe('uno.config.ts');
  });

  it('keeps Tailwind ahead of UnoCSS when a project carries both', () => {
    // Mid-migration projects do. Tailwind's cascade already demands a config file or a real
    // tailwindcss dependency, so it only wins here on a positive signal of its own.
    const p = detectProfile(
      baseInput({
        packageJson: { devDependencies: { tailwindcss: '^3.4.0', unocss: '^66.0.0' } },
        presentConfigFiles: ['tailwind.config.ts', 'uno.config.ts'],
      }),
    );
    expect(p.styling.system).toBe('tailwind');
    expect(p.styling.configPath).toBe('tailwind.config.ts');
  });

  it('detects SCSS from sass-embedded, which modern Vite projects use', () => {
    // The compiler Vite documents alongside `sass`, and the common choice on a Vite/Vue/Nuxt
    // project. Missing it meant the whole SCSS token source silently never ran there.
    for (const dep of ['sass', 'sass-embedded', 'node-sass']) {
      expect(
        detectProfile(baseInput({ packageJson: { devDependencies: { [dep]: '^1.80.0' } } })).styling
          .system,
      ).toBe('scss');
    }
  });

  it('falls back to scss / unknown styling', () => {
    expect(
      detectProfile(baseInput({ packageJson: { dependencies: { sass: '^1' } } })).styling.system,
    ).toBe('scss');
    expect(detectProfile(baseInput()).styling.system).toBe('unknown');
  });

  it('detects svg component mode + loader-specific import hint', () => {
    const svgr = detectProfile(
      baseInput({ packageJson: { dependencies: { 'vite-plugin-svgr': '^4' } } }),
    ).svg;
    expect(svgr).toEqual({
      mode: 'component',
      loader: 'vite-plugin-svgr',
      importHint: "import Icon from './icon.svg?react'",
    });

    const vue = detectProfile(
      baseInput({ packageJson: { dependencies: { 'vite-svg-loader': '^5' } } }),
    ).svg;
    expect(vue.mode).toBe('component');
    expect(vue.importHint).toContain('?component');

    const webpackSvgr = detectProfile(
      baseInput({ packageJson: { devDependencies: { '@svgr/webpack': '^8' } } }),
    ).svg;
    expect(webpackSvgr.importHint).toContain('ReactComponent');
  });

  it('falls back to svg url mode (no loader → no <Icon/>, just a URL)', () => {
    const svg = detectProfile(baseInput({ packageJson: { dependencies: { react: '^19' } } })).svg;
    expect(svg).toEqual({ mode: 'url' });
  });

  it('always records evidence for each conclusion', () => {
    const p = detectProfile(baseInput({ packageJson: { dependencies: { react: '^19' } } }));
    expect(p.evidence.some(e => e.startsWith('framework='))).toBe(true);
    expect(p.evidence.some(e => e.startsWith('styling='))).toBe(true);
    expect(p.evidence.some(e => e.startsWith('svg='))).toBe(true);
    expect(p.evidence.some(e => e.startsWith('classNaming='))).toBe(true);
  });
});

describe('gatherProjectInput + analyzeProject (real fs)', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'profile-test-'));
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({
        dependencies: { react: '^19.0.0' },
        devDependencies: { tailwindcss: '^4.0.0' },
      }),
    );
    await writeFile(join(dir, 'tsconfig.json'), '{}');
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(
      join(dir, 'src', 'app.css'),
      '@import "tailwindcss";\n@theme { --color-primary-500: #6266F0; }\n',
    );
    // a vendored CSS that must be ignored
    await mkdir(join(dir, 'node_modules', 'pkg'), { recursive: true });
    await writeFile(join(dir, 'node_modules', 'pkg', 'x.css'), '@import "tailwindcss";');
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('gathers manifest + tsconfig + the v4 CSS entry, skipping node_modules', async () => {
    const input = await gatherProjectInput(dir);
    expect(input.hasTsconfig).toBe(true);
    expect(input.tailwindCssEntry).toBe('src/app.css');
  });

  it('reports present config files in probe order, not stat-completion order', async () => {
    // The probes run in parallel, and detectStyling picks the *first* match out of this list, so a
    // project with more than one config present must not get a different answer run to run.
    const multi = await mkdtemp(join(tmpdir(), 'profile-order-'));
    try {
      await writeFile(join(multi, 'package.json'), '{}');
      for (const name of ['tailwind.config.ts', 'tailwind.config.js', 'uno.config.ts']) {
        await writeFile(join(multi, name), 'module.exports = {};');
      }
      const input = await gatherProjectInput(multi);
      // .js before .ts is the declared probe order; whichever file the filesystem answered for
      // first must not change it.
      expect(input.presentConfigFiles).toEqual([
        'tailwind.config.js',
        'tailwind.config.ts',
        'uno.config.ts',
      ]);
    } finally {
      await rm(multi, { recursive: true, force: true });
    }
  });

  it('analyzeProject end-to-end yields a react + tailwind-v4 + ts profile', async () => {
    const p = await analyzeProject(dir);
    expect(p.framework).toBe('react');
    expect(p.language).toBe('ts');
    expect(p.styling.system).toBe('tailwind');
    expect(p.styling.tailwindVersion).toBe(4);
    expect(p.styling.configPath).toBe('src/app.css');
  });
});

describe('readStylesheetNames / tallyClassNaming (pure)', () => {
  /** Score a whole project the way the scan does: read each file, then cross-reference the set. */
  const tallyOf = (...bodies: string[]) => tallyClassNaming(bodies.map(readStylesheetNames));

  it('counts `&` glued onto a name fragment, in either BEM position', () => {
    expect(tallyOf('.card { &__title { color: red; } &--wide { width: 100%; } }')).toEqual({
      ampersand: 2,
      flat: 0,
    });
  });

  it('ignores the `&` forms that nest a state instead of building a name', () => {
    // These say nothing about how the name was spelled — a flat stylesheet nests them too — so
    // counting them would report `ampersand` for a project that never concatenates.
    const body = `.card__title {
      &:hover { color: red; }
      &::before { content: ''; }
      &.is-open { display: block; }
      &[aria-current='page'] { font-weight: 700; }
      & > .icon { width: 1rem; }
      && { color: blue; }
    }`;
    expect(tallyOf(body).ampersand).toBe(0);
  });

  it('does not read a `&` out of a comment or a quoted value', () => {
    // `content: "&amp;"` and a commented-out rule are the two ways a stylesheet holds an `&` that
    // is not a selector at all.
    const body = [
      '.crumb::after { content: "&nbsp;"; }',
      '/* .card { &__title {} } */',
      '// &--legacy',
      '.card__label { color: red; }',
    ].join('\n');
    expect(tallyOf(body)).toEqual({ ampersand: 0, flat: 1 });
  });

  it('joins a wrapped line before reading it, so its tail is not mistaken for a rule', () => {
    // Verbatim shape from Vuetify's VAlert.sass. Left unjoined, the continuation lands in column 0,
    // the string pass can no longer see it as a value, and `content . ."` reads as an element
    // selector — one that then encloses every real rule indented under the wrapper, so the
    // declarations after it are scored as nested and never counted.
    const body = [
      "@include tools.layer('components')",
      '  .v-alert',
      '    grid-template-areas: "prepend content append close" ". \\',
      'content . ."',
      '  .v-alert-title',
      '    font-weight: 600',
    ];
    expect(tallyOf(body.join('\n'))).toEqual({ ampersand: 0, flat: 1 });
  });

  it('does not count a transition class as a preference for `&`', () => {
    // The author did not choose this spelling — the framework did, and the flat form is not even
    // available when the transition name is a prop. Measured on real libraries this was the
    // largest false signal: 16 of Element Plus's 35 concatenations, 134 of Vuetify's 713.
    const body = `.fade {
  &-enter-from { opacity: 0; }
  &-enter-active { transition: opacity 0.2s; }
  &-leave-to { opacity: 0; }
  &-move { transition: transform 0.2s; }
  &-exit-done { display: none; }
}`;
    expect(tallyOf(body).ampersand).toBe(0);
  });

  it('still counts a BEM name that merely starts with a transition word', () => {
    // The exclusion is keyed on a hyphen separator, so `__enter` / `--active` stay BEM.
    expect(tallyOf('.dialog {\n  &__enter { top: 0; }\n  &--active { top: 0; }\n}')).toEqual({
      ampersand: 2,
      flat: 0,
    });
  });

  it('counts a full compound name only at the top level', () => {
    // `.card { .card__title {} }` compiles to the descendant selector `.card .card__title`, which
    // is neither spelling — it is the wrong fix for this problem, so it must not vote for flat.
    expect(tallyOf('.card {\n  .card__title { color: red; }\n}').flat).toBe(0);
    expect(tallyOf('.card__title { color: red; }').flat).toBe(1);
  });

  it('still counts a rule that only an at-rule encloses', () => {
    // `@media`, `@layer` and a wrapping `@include` compile their contents to the same selector,
    // unnested — so what they contain is as top-level as it was. Reading indentation instead would
    // have scored these files as declaring nothing, which is not a hypothetical: it is why the
    // corpus first reported Vuetify as writing no full names at all.
    expect(tallyOf('@media (min-width: 40em) {\n  .card__title { color: red; }\n}').flat).toBe(1);
    expect(tallyOf('@layer components {\n  .card__title { color: red; }\n}').flat).toBe(1);
    expect(tallyOf('@include layer(components) {\n  .card__title { color: red; }\n}').flat).toBe(1);
  });

  it('reads the indented (.sass / .styl) syntax too, which has no braces to anchor on', () => {
    expect(tallyOf('.card\n  &__title\n    color: red\n')).toEqual({ ampersand: 1, flat: 0 });
    // The same at-rule wrapper, in the syntax where every real file has one.
    expect(
      tallyOf("@include tools.layer('components')\n  .card__title\n    color: red\n").flat,
    ).toBe(1);
    // …and nesting still has to be nesting: an enclosing *selector* disqualifies it.
    expect(tallyOf('.card\n  .card__title\n    color: red\n').flat).toBe(0);
  });

  it('does not mistake a top-level custom property for a compound class', () => {
    expect(tallyOf(':root {\n--color-primary-500: #6266f0;\n}').flat).toBe(0);
  });

  it('lets a single-hyphen scheme vote by cross-referencing the block it belongs to', () => {
    // `.accordion-body` and `.el-button` are textually identical; only one is a compound name. What
    // separates them is whether the project declares the head as a name of its own — which is the
    // whole reason the flat arm is scored per project rather than per file.
    expect(tallyOf('.accordion { }\n.accordion-body { }\n').flat).toBe(1);
    expect(tallyOf('.el-button { }\n').flat).toBe(0);
  });

  it('cross-references across files, not only within one', () => {
    // The block and the element it belongs to routinely live in different files; a per-file view
    // would see `.card-title` with no `.card` in sight and score a project's whole scheme as absent.
    expect(tallyOf('.card { }\n', '.card-title { }\n').flat).toBe(1);
  });

  it('counts BEM punctuation without corroboration from the rest of the project', () => {
    // Nothing but a compound name is spelled `__x`, so unlike a single-hyphen name it does not need
    // its block to have been declared anywhere.
    expect(tallyOf('.card__title { color: red; }\n').flat).toBe(1);
  });

  it('excludes a transition class on the flat side as well', () => {
    // The same exclusion as the `&` arm, on the other spelling of the same framework-dictated name
    // — applying it to one side only would discount a habit as evidence while still counting it.
    expect(tallyOf('.fade { }\n.fade-enter { }\n.fade-leave-to { }\n').flat).toBe(0);
  });

  it('does not read a Less mixin definition as a declared class name', () => {
    // `.size(@w, @h) {}` declares no class, and Ant Design ships 100+ of them. Read as names they
    // manufactured a flat majority for a library whose real class names are all interpolated.
    // Both parameter separators are pinned: `;` is the one that ends a statement everywhere else,
    // so a mixin written with it is the case where the prelude is easiest to lose.
    expect(readStylesheetNames('.size(@w, @h) {\n  width: @w;\n}\n').topLevel).toEqual([]);
    expect(readStylesheetNames('.size(@w; @h) {\n  width: @w;\n}\n').topLevel).toEqual([]);
    expect(
      readStylesheetNames('.typography-title-1() {\n  font-size: 2rem;\n}\n').topLevel,
    ).toEqual([]);
    expect(tallyOf('.size(@w, @h) { width: @w; }\n.size-lg { width: 4rem; }\n').flat).toBe(0);
  });

  it('keeps a mixin definition opaque, so what it nests is not scored as top level', () => {
    // The `;` between a mixin's parameters is the only `;` that does not end a statement. Treating
    // it as one leaves `@h)` as the prelude, which reads as an at-rule — and an at-rule is
    // transparent, so `.card__title` inside the mixin would be counted as a top-level declaration
    // when what it actually compiles to is a nested rule at every call site.
    expect(tallyOf('.mixin(@w; @h) {\n  .card__title { width: @w; }\n}\n').flat).toBe(0);
  });

  it('skips an interpolated name instead of guessing at what it compiles to', () => {
    // Bulma and Ant Design build nearly every selector this way. The name is unknowable without
    // evaluating the stylesheet, and a guess would be fiction dressed as evidence.
    expect(readStylesheetNames('.#{$class-prefix}button { color: red; }\n').topLevel).toEqual([]);
    expect(readStylesheetNames('.@{ant-prefix}-btn { color: red; }\n').topLevel).toEqual([]);
    expect(readStylesheetNames('.btn-@{variant} { color: red; }\n').topLevel).toEqual([]);
  });

  it('takes the leading class of each selector in a group, and only the leading one', () => {
    // `.card .icon` references a name declared elsewhere rather than declaring one here, so
    // counting it would let a descendant selector vouch for a name the project never defines.
    expect(readStylesheetNames('.card, .panel { color: red; }\n').topLevel).toEqual([
      'card',
      'panel',
    ]);
    expect(readStylesheetNames('.card .icon { color: red; }\n').topLevel).toEqual(['card']);
  });
});

describe('detectProfile — classNaming', () => {
  it('reports no habit when the project has no preprocessor stylesheet', () => {
    const p = detectProfile(baseInput());
    expect(p.styling.classNaming).toBeUndefined();
    expect(p.evidence).toContain('classNaming=none: no preprocessor stylesheet found');
  });

  it('separates "no stylesheets" from "stylesheets, but no compound class"', () => {
    // Both leave classNaming undefined, but only one of them means the scan actually looked and
    // found the project has no habit to match — the evidence line has to be able to say which.
    const p = detectProfile(
      baseInput({ classNamingTally: { ampersand: 0, flat: 0, filesScanned: 7 } }),
    );
    expect(p.styling.classNaming).toBeUndefined();
    expect(p.evidence.some(e => e.startsWith('classNaming=none: no compound class name'))).toBe(
      true,
    );
  });

  it('follows the plurality in either direction', () => {
    expect(
      detectProfile(baseInput({ classNamingTally: { ampersand: 30, flat: 2, filesScanned: 9 } }))
        .styling.classNaming,
    ).toBe('ampersand');
    expect(
      detectProfile(baseInput({ classNamingTally: { ampersand: 2, flat: 30, filesScanned: 9 } }))
        .styling.classNaming,
    ).toBe('flat');
  });

  it('does not let a handful of incidental concatenations claim an `&` habit', () => {
    // FLAT_COMPOUND cannot see a single-hyphen flat scheme (`.accordion-body` — Bootstrap's whole
    // vocabulary), so a bare `ampersand > flat` lets one legacy file outvote a flat majority that
    // was never counted. Below the floor the verdict is flat, because a wrong `ampersand` imposes
    // the unsearchable spelling while a wrong `flat` is merely unidiomatic.
    const p = detectProfile(
      baseInput({ classNamingTally: { ampersand: 4, flat: 0, filesScanned: 60 } }),
    );
    expect(p.styling.classNaming).toBe('flat');
    expect(p.evidence.some(e => e.includes('below the floor'))).toBe(true);
  });

  it('accepts an `&` habit once it is established rather than incidental', () => {
    expect(
      detectProfile(baseInput({ classNamingTally: { ampersand: 5, flat: 0, filesScanned: 60 } }))
        .styling.classNaming,
    ).toBe('ampersand');
  });

  it('breaks a tie toward flat', () => {
    // The two spellings compile identically, so the tiebreak costs nothing and keeps the property
    // only the flat form has: the name in the stylesheet is the name you can search for.
    const p = detectProfile(
      baseInput({ classNamingTally: { ampersand: 4, flat: 4, filesScanned: 3 } }),
    );
    expect(p.styling.classNaming).toBe('flat');
  });
});

describe('scanClassNaming (real fs)', () => {
  // Sized past AMPERSAND_FLOOR on purpose: a habit is what a real component stylesheet looks like,
  // and a fixture with two concatenations is exactly the incidental case the floor exists to reject.
  const BEM_SCSS = `.card {
  &__title { font-weight: 700; }
  &__body { padding: 16px; }
  &__footer { border-top: 1px solid; }
  &__action { cursor: pointer; }
  &--wide { width: 100%; }
  &--muted { opacity: 0.6; }
}
`;

  const withProject = async (
    files: Record<string, string>,
    assert: (dir: string) => Promise<void>,
  ) => {
    const dir = await mkdtemp(join(tmpdir(), 'profile-naming-'));
    try {
      await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({ devDependencies: { sass: '^1' } }),
      );
      for (const [rel, body] of Object.entries(files)) {
        const abs = join(dir, rel);
        await mkdir(join(abs, '..'), { recursive: true });
        await writeFile(abs, body);
      }
      await assert(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };

  it("learns the `&` habit from the project's own .scss", async () => {
    await withProject({ 'src/card.scss': BEM_SCSS }, async dir => {
      const p = await analyzeProject(dir);
      expect(p.styling.system).toBe('scss');
      expect(p.styling.classNaming).toBe('ampersand');
    });
  });

  it('learns the flat habit the same way', async () => {
    await withProject(
      { 'src/card.scss': '.card { color: red; }\n.card__title { font-weight: 700; }\n' },
      async dir => {
        expect((await analyzeProject(dir)).styling.classNaming).toBe('flat');
      },
    );
  });

  it('reads an SFC <style lang="scss"> block, which is the only stylesheet many Vue repos have', async () => {
    await withProject(
      {
        'src/Card.vue':
          '<template><div class="card" /></template>\n' +
          `<style lang="scss" scoped>\n${BEM_SCSS}</style>\n`,
      },
      async dir => {
        expect((await analyzeProject(dir)).styling.classNaming).toBe('ampersand');
      },
    );
  });

  it('ignores a plain SFC <style> block — CSS nesting cannot concatenate, so it holds no vote', async () => {
    await withProject(
      { 'src/Card.vue': '<style>\n.card { color: red; }\n</style>\n' },
      async dir => {
        const p = await analyzeProject(dir);
        expect(p.styling.classNaming).toBeUndefined();
        expect(p.evidence).toContain('classNaming=none: no preprocessor stylesheet found');
      },
    );
  });

  it('ignores .css entirely, so a big stylesheet cannot outvote the preprocessor files', async () => {
    await withProject(
      {
        'src/legacy.css': Array.from(
          { length: 50 },
          (_, i) => `.legacy__row-${i} { color: red; }`,
        ).join('\n'),
        'src/card.scss': BEM_SCSS,
      },
      async dir => {
        expect((await analyzeProject(dir)).styling.classNaming).toBe('ampersand');
      },
    );
  });

  it('counts .pcss / <style lang="postcss">, since postcss-nested concatenates the same way', async () => {
    await withProject(
      {
        'src/card.pcss': BEM_SCSS,
        'src/Row.vue': `<style lang="postcss">\n${BEM_SCSS}</style>\n`,
      },
      async dir => {
        const input = await gatherProjectInput(dir);
        expect(input.classNamingTally).toEqual({ ampersand: 12, flat: 0, filesScanned: 2 });
        expect(detectProfile(input).styling.classNaming).toBe('ampersand');
      },
    );
  });

  it('does not let a vendored stylesheet cast a vote', async () => {
    await withProject(
      {
        'src/card.scss': '.card__title { color: red; }\n',
        'node_modules/ui-kit/theme.scss': Array.from(
          { length: 40 },
          () => '.x {\n  &__y { color: red; }\n}',
        ).join('\n'),
      },
      async dir => {
        const input = await gatherProjectInput(dir);
        expect(input.classNamingTally).toEqual({ ampersand: 0, flat: 1, filesScanned: 1 });
        expect(detectProfile(input).styling.classNaming).toBe('flat');
      },
    );
  });
});
