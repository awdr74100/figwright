import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  analyzeProject,
  detectProfile,
  gatherProjectInput,
  type ProjectInput,
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
