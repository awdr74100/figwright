import type { DesignContextNode } from '@figma-mcp-relay/shared';
import { describe, expect, it } from 'vitest';

import type { RepoSvg } from '../../src/icons/repo-icons.js';
import { collectFigmaIcons, iconLabel, joinIcons } from '../../src/join/icon-map.js';
import type { ProjectProfile } from '../../src/profile/profile.js';

const svgProfile = (
  mode: 'component' | 'url',
  loader?: string,
  importHint?: string,
): ProjectProfile['svg'] => ({
  mode,
  ...(loader === undefined ? {} : { loader }),
  ...(importHint === undefined ? {} : { importHint }),
});

const node = (over: Partial<DesignContextNode> & { id: string }): DesignContextNode => ({
  name: 'Frame',
  type: 'FRAME',
  ...over,
});

const svg = (
  fileName: string,
  colorContract: RepoSvg['colorContract'] = 'currentColor',
  path = `src/assets/icons/${fileName}.svg`,
): RepoSvg => ({ path, fileName, colorContract });

describe('iconLabel', () => {
  it('strips the icon decoration off Figma names', () => {
    expect(iconLabel('ic_search')).toBe('search');
    expect(iconLabel('icon-chevron-down')).toBe('chevron-down');
    expect(iconLabel('Icons/Arrow Right')).toBe('Arrow Right');
    expect(iconLabel('arrow-left')).toBe('arrow-left');
  });
});

describe('collectFigmaIcons', () => {
  it('finds VECTOR leaves with meaningful names, skipping default-named decoration', () => {
    const icons = collectFigmaIcons([
      node({
        id: 'root',
        children: [
          node({ id: 'v1', type: 'VECTOR', name: 'search' }),
          node({ id: 'v2', type: 'VECTOR', name: 'Vector 3' }), // decoration → skipped
        ],
      }),
    ]);
    expect(icons.map(i => i.name)).toEqual(['search']);
  });

  it('detects icon instances by the icon marker and stops descending into them', () => {
    const icons = collectFigmaIcons([
      node({
        id: 'btn',
        children: [
          node({
            id: 'inst',
            type: 'INSTANCE',
            name: 'ic_arrow-right',
            children: [node({ id: 'inner', type: 'VECTOR', name: 'Union' })], // not double-counted
          }),
        ],
      }),
    ]);
    expect(icons).toHaveLength(1);
    expect(icons[0]?.name).toBe('arrow-right');
    expect(icons[0]?.nodeIds).toEqual(['inst']);
  });

  it('groups repeated icon usages into one row with all node ids + carries the fill', () => {
    const fills = [
      { type: 'SOLID' as const, visible: true, opacity: 1, color: { r: 1, g: 0, b: 0 } },
    ];
    const icons = collectFigmaIcons([
      node({ id: 'a', type: 'VECTOR', name: 'search', fills }),
      node({ id: 'b', type: 'VECTOR', name: 'Search' }),
    ]);
    expect(icons).toHaveLength(1);
    expect(icons[0]?.nodeIds).toEqual(['a', 'b']);
    expect(icons[0]?.fill?.hex).toBe('#FF0000');
  });

  it('prefers the component set name for a variant instance', () => {
    const icons = collectFigmaIcons([
      node({
        id: 'i',
        type: 'INSTANCE',
        name: 'Size=24',
        mainComponent: { id: 'm', key: 'k', name: 'Size=24', componentSetName: 'Icons/Bell' },
      }),
    ]);
    expect(icons[0]?.name).toBe('Bell');
  });
});

const opts = (
  svgP = svgProfile('component', 'vite-svg-loader', "import Icon from './icon.svg?component'"),
): Parameters<typeof joinIcons>[2] => ({
  threshold: 0.7,
  svg: svgP,
  tailwind: true,
});

describe('joinIcons', () => {
  it('matches a Figma icon to the curated svg by path (no fabricated import)', () => {
    const [m] = joinIcons(
      [{ name: 'arrow-right', figmaName: 'ic_arrow-right', nodeIds: ['n1'] }],
      [svg('arrow-right'), svg('search')],
      opts(),
    );
    expect(m?.status).toBe('high');
    expect(m?.candidate?.filePath).toBe('src/assets/icons/arrow-right.svg');
    expect(m?.candidate).not.toHaveProperty('import');
  });

  it('currentColor + component mode → recolor via text-{token}', () => {
    const [m] = joinIcons(
      [{ name: 'search', figmaName: 'search', nodeIds: ['n'] }],
      [svg('search', 'currentColor')],
      opts(),
    );
    expect(m?.candidate?.colorContract).toBe('currentColor');
    expect(m?.candidate?.recolor).toContain('text-{token}');
  });

  it('currentColor + url mode → warns currentColor dies through <img>', () => {
    const [m] = joinIcons(
      [{ name: 'search', figmaName: 'search', nodeIds: ['n'] }],
      [svg('search', 'currentColor')],
      opts(svgProfile('url')),
    );
    expect(m?.candidate?.recolor).toContain("can't apply through an <img>");
  });

  it('fixed-color file → reports not recolorable', () => {
    const [m] = joinIcons(
      [{ name: 'logo', figmaName: 'logo', nodeIds: ['n'] }],
      [svg('logo', 'fixed')],
      opts(),
    );
    expect(m?.candidate?.recolor).toContain('not recolorable');
  });

  it('no match → unmapped (codegen exports fresh)', () => {
    const [m] = joinIcons(
      [{ name: 'sparkles', figmaName: 'sparkles', nodeIds: ['n'] }],
      [svg('arrow-right'), svg('search')],
      opts(),
    );
    expect(m?.status).toBe('unmapped');
    expect(m?.candidate).toBeUndefined();
  });

  it('normalizes separators/spaces so naming drift still matches exactly', () => {
    const [m] = joinIcons(
      [{ name: 'radio button', figmaName: 'icon/radio button', nodeIds: ['n'] }],
      [svg('radio-button')],
      opts(),
    );
    expect(m?.status).toBe('high');
    expect(m?.candidate?.filePath).toBe('src/assets/icons/radio-button.svg');
  });

  it('does NOT fuzzy-match a near-neighbor to the wrong icon (precision over recall)', () => {
    // Design C A/B regression: arr-u must not reuse arr-d (opposite arrows), checkbox must not reuse
    // check, cash must not reuse trash. A wrong icon is a silent visual bug, so these fall through
    // to a fresh export instead of a confident mis-map.
    const files = [svg('arr-d'), svg('check'), svg('trash')];
    const statuses = ['arr-u', 'checkbox', 'cash'].map(name => {
      const [m] = joinIcons([{ name, figmaName: `icon/${name}`, nodeIds: ['n'] }], files, opts());
      return [name, m?.status] as const;
    });
    expect(statuses).toEqual([
      ['arr-u', 'unmapped'],
      ['checkbox', 'unmapped'],
      ['cash', 'unmapped'],
    ]);
  });
});
