import { readFile } from 'node:fs/promises';

import { walkRepoFiles } from '../repo-walk.js';

// The repo side of the icon join: the project's existing, curated `.svg` files (the ones a designer
// hands over), plus any installed icon component library. Both are read off disk so the join only ever
// claims a reuse it can verify — a matched file actually exists; a library is only surfaced when it's a
// real dependency. The matching itself stays pure in join/icon-map.ts.

/**
 * The color contract an icon's fill obeys, read from the SVG's own markup — this decides whether
 * codegen may recolor it and how:
 *
 * - `currentColor`: fills/strokes are `currentColor` → recolorable via the CSS `color` property
 *   (Tailwind `text-*`), and it inherits from the parent. The single-color, designer-prepped case.
 * - `fixed`: exactly one hard-coded color → baked in, not recolorable via CSS.
 * - `multi-color`: several colors / a gradient / an embedded raster → render as-is, never recolor.
 * - `unknown`: no explicit fill and no `currentColor` → can't tell; codegen should inspect.
 */
export type SvgColorContract = 'currentColor' | 'fixed' | 'multi-color' | 'unknown';

export interface RepoSvg {
  /** Repo-relative posix path, e.g. "src/assets/icons/arrow-right.svg". */
  path: string;
  /** Basename without extension, raw (e.g. "arrow-right", "ic_search"). */
  fileName: string;
  colorContract: SvgColorContract;
}

// Pull every fill/stroke color the markup commits to: presentation attributes (`fill="#111"`) and
// inline styles (`style="fill:#111"`). url(#…) references (gradients) and rasters are handled
// separately as a hard multi-color signal.
const COLOR_TOKEN = /(?:fill|stroke)\s*[:=]\s*["']?\s*([^"';\s/>]+)/gi;
const GRADIENT_OR_IMAGE = /<(?:linear|radial)gradient|url\(#|<image\b/i;

const isNoColor = (v: string): boolean => {
  const c = v.toLowerCase();
  return c === 'none' || c === 'transparent' || c === 'inherit';
};

/** Classify an SVG's color contract from its markup. Conservative: `currentColor` wins outright. */
export const classifySvgColor = (svg: string): SvgColorContract => {
  const colors = new Set<string>();
  let sawCurrentColor = false;
  for (const m of svg.matchAll(COLOR_TOKEN)) {
    const value = (m[1] ?? '').toLowerCase();
    if (value === 'currentcolor') sawCurrentColor = true;
    else if (!isNoColor(value)) colors.add(value);
  }
  // A loader/designer convention is to drive a single-color icon entirely off currentColor; any
  // currentColor presence means the icon is meant to be recolored by inherited color.
  if (sawCurrentColor) return 'currentColor';
  if (GRADIENT_OR_IMAGE.test(svg)) return 'multi-color';
  if (colors.size === 0) return 'unknown';
  return colors.size === 1 ? 'fixed' : 'multi-color';
};

/**
 * Scan the project for curated `.svg` icon files (gitignore-aware), reading each one's color
 * contract.
 */
export const scanRepoSvgs = async (rootDir: string): Promise<RepoSvg[]> => {
  const out: RepoSvg[] = [];
  for await (const path of walkRepoFiles(rootDir, { extensions: ['.svg'] })) {
    let content: string;
    try {
      // eslint-disable-next-line no-await-in-loop -- bounded by the walker's cap; clarity over batching
      content = await readFile(`${rootDir}/${path}`, 'utf8');
    } catch {
      continue;
    }
    const base = path.split('/').pop() ?? path;
    out.push({
      path,
      fileName: base.replace(/\.svg$/i, ''),
      colorContract: classifySvgColor(content),
    });
  }
  return out;
};

// Icon component libraries: when one is installed, an unmapped Figma icon can be imported from it
// instead of exported fresh. We only *report which libraries are present* (verifiable from deps) and
// never fabricate a per-icon import — we can't confirm a given package actually exports a given icon
// without resolving it, and a hallucinated `import { Foo } from 'lucide-react'` is worse than an
// honest "export it". Ordered most- to least-common so the report is stable.
const ICON_LIBRARY_DEPS: readonly string[] = [
  'lucide-react',
  'lucide-vue-next',
  '@tabler/icons-react',
  '@tabler/icons-vue',
  '@heroicons/react',
  '@heroicons/vue',
  '@phosphor-icons/react',
  '@phosphor-icons/vue',
  'react-icons',
  'react-feather',
  '@radix-ui/react-icons',
  'unplugin-icons', // iconify-backed: import from `~icons/{collection}/{name}`
];

/** Detected icon component libraries (dep names) present in the project, in report order. */
export const detectIconLibraries = (deps: Record<string, string>): string[] =>
  ICON_LIBRARY_DEPS.filter(dep => dep in deps);
