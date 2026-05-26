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

  it('falls back to scss / unknown styling', () => {
    expect(
      detectProfile(baseInput({ packageJson: { dependencies: { sass: '^1' } } })).styling.system,
    ).toBe('scss');
    expect(detectProfile(baseInput()).styling.system).toBe('unknown');
  });

  it('always records evidence for each conclusion', () => {
    const p = detectProfile(baseInput({ packageJson: { dependencies: { react: '^19' } } }));
    expect(p.evidence.some(e => e.startsWith('framework='))).toBe(true);
    expect(p.evidence.some(e => e.startsWith('styling='))).toBe(true);
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

  it('analyzeProject end-to-end yields a react + tailwind-v4 + ts profile', async () => {
    const p = await analyzeProject(dir);
    expect(p.framework).toBe('react');
    expect(p.language).toBe('ts');
    expect(p.styling.system).toBe('tailwind');
    expect(p.styling.tailwindVersion).toBe(4);
    expect(p.styling.configPath).toBe('src/app.css');
  });
});
