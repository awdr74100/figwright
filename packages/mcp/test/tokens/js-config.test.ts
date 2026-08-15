import { describe, expect, it } from 'vitest';

import { parseTailwindConfig, parseUnoConfig } from '../../src/tokens/js-config.js';

/** Parse a config and index the tokens by name, which is how every assertion below reads them. */
const parse = (code: string, file = 'tailwind.config.ts') => {
  const { tokens, skipped } = parseTailwindConfig(file, code);
  return { skipped, tokens, byName: new Map(tokens.map(t => [t.name, t])) };
};

/** Same, for an UnoCSS config. */
const parseUno = (code: string, file = 'uno.config.ts') => {
  const { tokens, skipped, themeFound } = parseUnoConfig(file, code);
  return { skipped, themeFound, tokens, byName: new Map(tokens.map(t => [t.name, t])) };
};

/** Wrap a theme body in the shape a real uno.config.ts uses, with the given presets expression. */
const unoConfig = (presets: string, theme: string): string =>
  `import { defineConfig, presetUno } from 'unocss'
   import presetWind4 from '@unocss/preset-wind4'
   export default defineConfig({ presets: [${presets}], theme: { ${theme} } })`;

describe('parseTailwindConfig', () => {
  describe('locating the config object', () => {
    const theme = "{ theme: { extend: { colors: { brand: '#6266F0' } } } }";
    /** The one token every form below declares, so each case asserts on the same value. */
    const brand = (code: string, file?: string): string | undefined =>
      parse(code, file).byName.get('color-brand')?.value;

    it('reads `export default { … }`', () => {
      expect(brand(`export default ${theme};`)).toBe('#6266F0');
    });

    it('reads `module.exports = { … }`', () => {
      expect(brand(`module.exports = ${theme};`, 'tailwind.config.js')).toBe('#6266F0');
    });

    it('reads an identifier default export declared in the same file', () => {
      // The shape almost every TypeScript config uses.
      expect(
        brand(`import type { Config } from 'tailwindcss';
        const config: Config = ${theme};
        export default config;`),
      ).toBe('#6266F0');
    });

    it('reads through `satisfies` / `as` / a defineConfig-style wrapper', () => {
      expect(brand(`export default ${theme} satisfies Config;`)).toBe('#6266F0');
      expect(brand(`export default ${theme} as Config;`)).toBe('#6266F0');
      expect(brand(`export default defineConfig(${theme});`)).toBe('#6266F0');
    });

    it('reports themeFound: false for a config whose theme it cannot see, and never throws', () => {
      const unreachable = { tokens: [], skipped: 0, themeFound: false };
      // The theme is in another file (a required base, or a `presets` entry).
      expect(
        parseTailwindConfig('tailwind.config.js', "module.exports = require('./theme')"),
      ).toEqual(unreachable);
      expect(parseTailwindConfig('tailwind.config.ts', 'export default {};')).toEqual(unreachable);
      // Malformed input degrades rather than taking down the grounding call that asked for it.
      expect(parseTailwindConfig('tailwind.config.js', 'module.exports = { theme: {')).toEqual(
        unreachable,
      );
    });

    it('distinguishes an empty theme from an unreachable one', () => {
      // `theme: { extend: {} }` is one of the commonest real shapes (usebruno, refine's examples).
      // It was read perfectly well and simply declares nothing — reporting it as unreadable would
      // send someone looking for a parser bug that isn't there.
      expect(
        parseTailwindConfig('tailwind.config.js', 'module.exports = { theme: { extend: {} } };'),
      ).toEqual({ tokens: [], skipped: 0, themeFound: true });
    });
  });

  describe('token shape', () => {
    it('emits the same name / utility / category vocabulary the v4 @theme path emits', () => {
      const { byName } = parse(`export default {
        theme: { extend: { colors: { primary: { 500: '#6266F0' } } } },
      };`);
      expect(byName.get('color-primary-500')).toEqual({
        name: 'color-primary-500',
        value: '#6266F0',
        utility: 'primary-500',
        category: 'color',
      });
    });

    it('carries no cssVar — v3 declares no custom properties', () => {
      const { tokens } = parse("export default { theme: { colors: { brand: '#fff' } } };");
      expect(tokens.every(t => t.cssVar === undefined)).toBe(true);
    });

    it('maps every scale that has an unambiguous v4 namespace', () => {
      const { byName } = parse(`export default {
        theme: { extend: {
          spacing: { 4.5: '1.125rem' },
          fontSize: { sm: '0.875rem' },
          fontFamily: { display: 'Inter' },
          fontWeight: { bold: 700 },
          letterSpacing: { tight: '-0.02em' },
          lineHeight: { snug: '1.375' },
          borderRadius: { lg: '0.5rem' },
          boxShadow: { card: '0 1px 2px rgb(0 0 0 / 0.05)' },
          screens: { tablet: '768px' },
          maxWidth: { prose: '65ch' },
          blur: { xs: '2px' },
          aspectRatio: { golden: '1.618' },
          transitionTimingFunction: { swift: 'cubic-bezier(0.4, 0, 0.2, 1)' },
          animation: { shimmer: 'shimmer 2s linear infinite' },
        } },
      };`);
      expect([...byName.keys()]).toEqual([
        'spacing-4.5',
        'text-sm',
        'font-display',
        'font-weight-bold',
        'tracking-tight',
        'leading-snug',
        'radius-lg',
        'shadow-card',
        'container-prose',
        'blur-xs',
        // The scales UnoCSS names differently come after the ones both frameworks share, so the
        // emitted order is stable regardless of how the config happens to declare them.
        'breakpoint-tablet',
        'ease-swift',
        'aspect-golden',
        'animate-shimmer',
      ]);
      // A numeric leaf is still a value (fontWeight: 700).
      expect(byName.get('font-weight-bold')?.value).toBe('700');
    });

    it('drops scales with no bare-base utility instead of inventing a ref', () => {
      // `z-modal` is the class, not `modal` — emitting `modal` as a ref would be a literal that
      // does not exist. Not a parse failure either, so it must not inflate `skipped`.
      const { tokens, skipped } = parse(`export default {
        content: ['./src/**/*.tsx'],
        theme: { extend: { zIndex: { modal: '100' }, keyframes: { spin: { to: {} } } } },
      };`);
      expect(tokens).toEqual([]);
      expect(skipped).toBe(0);
    });
  });

  describe('Tailwind key semantics', () => {
    it('collapses a trailing DEFAULT to the parent name', () => {
      const { byName } = parse(`export default {
        theme: { colors: { primary: { DEFAULT: '#111', 500: '#6266F0' } } },
      };`);
      // colors.primary.DEFAULT is the `primary` token — Tailwind writes it `bg-primary`.
      expect(byName.get('color-primary')?.value).toBe('#111');
      expect(byName.get('color-primary-500')?.value).toBe('#6266F0');
      expect(byName.has('color-primary-DEFAULT')).toBe(false);
    });

    it('flattens arbitrarily nested scales', () => {
      const { byName } = parse(`export default {
        theme: { colors: { brand: { accent: { subtle: '#eef' } } } },
      };`);
      expect(byName.get('color-brand-accent-subtle')?.utility).toBe('brand-accent-subtle');
    });

    it('lets theme.extend win a collision with the base theme, as Tailwind does', () => {
      const { tokens, byName } = parse(`export default {
        theme: {
          colors: { brand: '#000000' },
          extend: { colors: { brand: '#6266F0' } },
        },
      };`);
      expect(byName.get('color-brand')?.value).toBe('#6266F0');
      // One name, one token — emitting both would read as a token ambiguous with itself.
      expect(tokens.filter(t => t.name === 'color-brand')).toHaveLength(1);
    });

    it('reads a string key and a template literal without interpolation', () => {
      const { byName } = parse("export default { theme: { colors: { 'off-white': `#FAFAFA` } } };");
      expect(byName.get('color-off-white')?.value).toBe('#FAFAFA');
    });
  });

  describe('array values', () => {
    it('joins a font stack', () => {
      const { byName } = parse(
        "export default { theme: { fontFamily: { sans: ['Inter', 'ui-sans-serif'] } } };",
      );
      expect(byName.get('font-sans')?.value).toBe('Inter, ui-sans-serif');
    });

    it('takes the size from a [size, options] font-size entry', () => {
      const { byName } = parse(
        "export default { theme: { fontSize: { sm: ['0.875rem', { lineHeight: '1.25rem' }] } } };",
      );
      // The companion line-height is its own scale on the design side; this token is the size.
      expect(byName.get('text-sm')?.value).toBe('0.875rem');
    });
  });

  describe('real configs from upstream projects', () => {
    // Verbatim from nuxt/ui v2.21.1 (docs/tailwind.config.ts). Its `<Partial<Config>>` angle-bracket
    // cast is a form no invented fixture had, and handling only `as`/`satisfies` dropped the whole
    // config silently — every token gone, with nothing to say so.
    const nuxtUi = `import type { Config } from 'tailwindcss'
import defaultTheme from 'tailwindcss/defaultTheme'

export default <Partial<Config>>{
  theme: {
    extend: {
      fontFamily: {
        sans: ['DM Sans', ...defaultTheme.fontFamily.sans]
      },
      colors: {
        green: {
          50: '#EFFDF5',
          400: '#00DC82',
          950: '#052e16'
        }
      },
      gridRow: {
        'span-8': 'span 8 / span 8'
      }
    }
  }
}`;

    it('reads the nuxt/ui config through its angle-bracket cast', () => {
      const { byName, skipped } = parse(nuxtUi);
      expect(byName.get('color-green-400')).toEqual({
        name: 'color-green-400',
        value: '#00DC82',
        utility: 'green-400',
        category: 'color',
      });
      expect(byName.get('color-green-50')?.value).toBe('#EFFDF5');
      // A stack truncated by a spread keeps its primary family — the name a Figma font token uses.
      expect(byName.get('font-sans')?.value).toBe('DM Sans');
      // gridRow has no v4 namespace and no bare-base utility, so it is dropped, not guessed.
      expect(byName.has('gridRow-span-8')).toBe(false);
      expect(skipped).toBe(0);
    });

    it('finds no theme in a config assembled by spreading a required base', () => {
      // Verbatim from shadcn-ui 0.9.4 (apps/www/tailwind.config.cjs): the theme lives in a file this
      // never opens. The right answer is zero tokens plus a note — load.ts then still pools the
      // project's CSS, which is where such a project's tokens are readable.
      const shadcn = `const baseConfig = require("../../tailwind.config.cjs")

/** @type {import('tailwindcss').Config} */
module.exports = {
  ...baseConfig,
  content: [
    ...baseConfig.content,
    "content/**/*.mdx",
  ],
}`;
      expect(parseTailwindConfig('tailwind.config.cjs', shadcn)).toEqual({
        tokens: [],
        skipped: 0,
        themeFound: false,
      });
    });
  });

  describe('what it refuses to guess', () => {
    it('skips and counts entries it cannot evaluate by reading them', () => {
      const { byName, skipped } = parse(`export default {
        theme: { extend: { colors: {
          ...require('tailwindcss/colors'),
          [dynamicKey]: '#123456',
          computed: makeColor('primary'),
          interpolated: \`#\${hex}\`,
          brand: '#6266F0',
        } } },
      };`);
      // The one readable entry still lands; the four unreadable ones are reported, not invented.
      expect([...byName.keys()]).toEqual(['color-brand']);
      expect(skipped).toBe(4);
    });

    it('counts an unreadable scale without losing the readable ones beside it', () => {
      const { byName, skipped } = parse(`export default {
        theme: { extend: {
          colors: theme => ({ brand: theme('colors.blue.500') }),
          borderRadius: { lg: '0.5rem' },
        } },
      };`);
      expect([...byName.keys()]).toEqual(['radius-lg']);
      expect(skipped).toBe(0); // a non-object scale isn't walked at all — nothing inside was hidden
    });
  });
});

describe('parseUnoConfig', () => {
  // Every expectation below was first confirmed by generating CSS from an installed UnoCSS — the
  // family resemblance to Tailwind is close enough to be misleading, and four of these differ.
  describe('wind3-era vocabulary (presetUno / presetWind3 / presetMini)', () => {
    it('emits the same token vocabulary as the equivalent Tailwind config', () => {
      const { byName } = parseUno(
        unoConfig('presetUno()', "colors: { primary: { 500: '#6266F0' } }"),
      );
      expect(byName.get('color-primary-500')).toEqual({
        name: 'color-primary-500',
        value: '#6266F0',
        utility: 'primary-500',
        category: 'color',
      });
    });

    it('reads breakpoints and easing, which Tailwind calls screens and transitionTimingFunction', () => {
      const { byName } = parseUno(
        unoConfig(
          'presetUno()',
          `breakpoints: { tablet: '768px' },
           easing: { swift: 'cubic-bezier(0.4,0,0.2,1)' },`,
        ),
      );
      expect(byName.get('breakpoint-tablet')?.value).toBe('768px');
      expect(byName.get('ease-swift')?.utility).toBe('swift');
    });

    it("ignores the Tailwind spellings, which UnoCSS's own theme has no keys for", () => {
      const { tokens } = parseUno(
        unoConfig(
          'presetUno()',
          `screens: { desktop: '1400px' },
           transitionTimingFunction: { swifty: 'linear' },
           aspectRatio: { golden: '1.618' },`,
        ),
      );
      // Reading these would emit breakpoint-desktop / ease-swifty / aspect-golden, none of which
      // UnoCSS generates a class for — the exact "confidently wrong ref" this must not produce.
      expect(tokens).toEqual([]);
    });

    it('leaves the structured animation and container objects alone', () => {
      const { tokens } = parseUno(
        unoConfig(
          'presetUno()',
          `animation: { keyframes: { spin: 'from{}' }, durations: { spin: '1s' } },
           container: { center: true, padding: '1rem' },`,
        ),
      );
      // Both are options objects, not scales. Walking them would emit animate-keyframes-spin and
      // container-center.
      expect(tokens).toEqual([]);
    });
  });

  describe('wind4 vocabulary', () => {
    const wind4Theme = `colors: { primary: { 500: '#6266F0', DEFAULT: '#111' } },
       text: { huge: { fontSize: '48px', lineHeight: '1.1' } },
       font: { display: 'Inter' },
       tracking: { loose2: '0.1em' },
       leading: { tall2: '2.5' },
       radius: { blob: '14px' },
       shadow: { card: '0 1px 2px #0001' },
       breakpoint: { tablet: '768px' },
       container: { prose2: '65ch' },
       ease: { swift: 'linear' },`;

    it('switches vocabulary when the presets name wind4', () => {
      const { byName } = parseUno(unoConfig('presetWind4()', wind4Theme));
      expect([...byName.keys()].toSorted()).toEqual([
        'breakpoint-tablet',
        'color-primary',
        'color-primary-500',
        'container-prose2',
        'ease-swift',
        'font-display',
        'leading-tall2',
        'radius-blob',
        'shadow-card',
        'text-huge',
        'tracking-loose2',
      ]);
    });

    it('takes fontSize out of a text entry rather than descending into it', () => {
      const { byName } = parseUno(unoConfig('presetWind4()', wind4Theme));
      // wind4's `text` leaves are option objects; descending would emit text-huge-fontSize, a name
      // for nothing, and lose the size entirely.
      expect(byName.get('text-huge')?.value).toBe('48px');
      expect(byName.has('text-huge-fontSize')).toBe(false);
      expect(byName.has('text-huge-lineHeight')).toBe(false);
    });

    it('reads container as a scale here, unlike in wind3 where it is an options object', () => {
      expect(
        parseUno(unoConfig('presetWind4()', wind4Theme)).byName.get('container-prose2')?.value,
      ).toBe('65ch');
      // This is the collision that stops the two vocabularies being merged into one table.
      expect(parseUno(unoConfig('presetUno()', "container: { prose2: '65ch' }")).tokens).toEqual(
        [],
      );
    });

    it('defaults to the wind3 vocabulary when the presets cannot be read', () => {
      // presetUno re-exports wind3, and a config whose presets come from elsewhere is likelier to
      // be on the long-standing vocabulary than the new one.
      const { byName } = parseUno(
        `export default { presets: [...sharedPresets], theme: { fontSize: { huge: '48px' }, radius: { blob: '14px' } } }`,
      );
      expect(byName.has('text-huge')).toBe(true);
      expect(byName.has('radius-blob')).toBe(false);
    });
  });
});
