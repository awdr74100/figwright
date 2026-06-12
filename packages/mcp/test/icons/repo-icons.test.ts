import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { classifySvgColor, detectIconLibraries, scanRepoSvgs } from '../../src/icons/repo-icons.js';

describe('classifySvgColor', () => {
  it('currentColor wins outright (single-color, designer-prepped)', () => {
    expect(classifySvgColor('<svg><path fill="currentColor" d="M0"/></svg>')).toBe('currentColor');
    // even alongside a hard color elsewhere, any currentColor means "meant to be recolored"
    expect(classifySvgColor('<svg><path fill="currentColor"/><path stroke="#000"/></svg>')).toBe(
      'currentColor',
    );
  });

  it('one hard color → fixed', () => {
    expect(classifySvgColor('<svg><path fill="#111827"/></svg>')).toBe('fixed');
    expect(classifySvgColor('<svg><path style="fill:#111827"/></svg>')).toBe('fixed');
  });

  it('several colors or a gradient/raster → multi-color', () => {
    expect(classifySvgColor('<svg><path fill="#111"/><path fill="#f00"/></svg>')).toBe(
      'multi-color',
    );
    expect(classifySvgColor('<svg><linearGradient/><path fill="url(#g)"/></svg>')).toBe(
      'multi-color',
    );
  });

  it('no explicit fill and no currentColor → unknown', () => {
    expect(classifySvgColor('<svg><path d="M0 0"/></svg>')).toBe('unknown');
    // none/transparent are not committed colors
    expect(classifySvgColor('<svg><path fill="none"/></svg>')).toBe('unknown');
  });
});

describe('detectIconLibraries', () => {
  it('reports installed icon component libraries in order, ignoring others', () => {
    expect(detectIconLibraries({ 'lucide-react': '^0.4', react: '^19' })).toEqual(['lucide-react']);
    expect(detectIconLibraries({ '@heroicons/vue': '^2', 'lucide-react': '^0.4' })).toEqual([
      'lucide-react',
      '@heroicons/vue',
    ]);
    expect(detectIconLibraries({ vue: '^3' })).toEqual([]);
  });
});

describe('scanRepoSvgs', () => {
  let dir: string;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('walks .svg files and reads each color contract, skipping node_modules', async () => {
    dir = await mkdtemp(join(tmpdir(), 'svg-test-'));
    const write = async (rel: string, body: string): Promise<void> => {
      await mkdir(join(dir, rel, '..'), { recursive: true });
      await writeFile(join(dir, rel), body);
    };
    await write('src/icons/search.svg', '<svg><path fill="currentColor"/></svg>');
    await write('src/icons/logo.svg', '<svg><path fill="#123456"/></svg>');
    await write('node_modules/pkg/x.svg', '<svg><path fill="#000"/></svg>');

    const svgs = await scanRepoSvgs(dir);
    const byName = Object.fromEntries(svgs.map(s => [s.fileName, s.colorContract]));
    expect(byName).toEqual({ search: 'currentColor', logo: 'fixed' });
    expect(svgs.some(s => s.path.includes('node_modules'))).toBe(false);
  });
});
