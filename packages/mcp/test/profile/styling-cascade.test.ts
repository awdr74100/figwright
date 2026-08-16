import { describe, expect, it } from 'vitest';

import { detectProfile, isUtilityFirst, type ProjectInput } from '../../src/profile/profile.js';

// The styling cascade decides two things a caller acts on — which file the tokens are read from, and
// whether a token's utility base is a real class — so an ordering mistake in it produces confidently
// wrong code rather than a missing match. Three such mistakes reached review one at a time, each
// found only because someone happened to imagine that combination of signals.
//
// So this pins the whole matrix rather than another scenario: every meaningful pairing of the five
// signals detection reads, with the answer written out. A new branch that changes any pairing has to
// change a row here and say so — which is the property the one-off tests never had.
//
// Signals, strongest evidence first by design:
//   1. a root `tailwind.config.*`            → Tailwind v3
//   2. a root `uno.config.*`                 → UnoCSS
//   3. a repo CSS file with @import/@theme   → Tailwind v4, but only when a dep backs it
//   4. a tailwindcss / @tailwindcss/* dep    → Tailwind
//   5. an UnoCSS dep that carries a theme    → UnoCSS

type Signals = {
  v3?: boolean;
  uno?: boolean;
  css?: boolean;
  deps?: Record<string, string>;
  /** What the uno config was found to load; undefined = no config, or its presets were unreadable. */
  unoVocab?: boolean;
};

const detect = ({ v3, uno, css, deps, unoVocab }: Signals) => {
  const presentConfigFiles: string[] = [];
  if (v3 === true) presentConfigFiles.push('tailwind.config.ts');
  if (uno === true) presentConfigFiles.push('uno.config.ts');
  const input: ProjectInput = {
    rootDir: '/x',
    packageJson: { devDependencies: deps ?? {} },
    hasTsconfig: true,
    presentConfigFiles,
    ...(css === true ? { tailwindCssEntry: 'src/app.css' } : {}),
    ...(unoVocab === undefined ? {} : { unoConfigDeclaresVocabulary: unoVocab }),
  };
  return detectProfile(input).styling;
};

const TW3 = { tailwindcss: '^3.4.0' };
const TW4 = { tailwindcss: '^4.0.0', '@tailwindcss/vite': '^4.0.0' };
const UNO = { unocss: '^66.0.0' };

describe('styling cascade matrix', () => {
  const cases: [name: string, signals: Signals, system: string, configPath: string | undefined][] =
    [
      // — single signals —
      ['v3 config alone', { v3: true, deps: TW3 }, 'tailwind', 'tailwind.config.ts'],
      ['uno config alone', { uno: true, deps: UNO }, 'unocss', 'uno.config.ts'],
      ['v4 CSS marker + dep', { css: true, deps: TW4 }, 'tailwind', 'src/app.css'],
      ['tailwind dep alone', { deps: TW3 }, 'tailwind', undefined],
      ['unocss dep alone', { deps: UNO }, 'unocss', undefined],
      ['nothing', {}, 'unknown', undefined],

      // — config file beats a bare dependency of the other framework —
      [
        'uno config vs tailwind dep',
        { uno: true, deps: { ...UNO, ...TW3 } },
        'unocss',
        'uno.config.ts',
      ],
      [
        'v3 config vs unocss dep',
        { v3: true, deps: { ...TW3, ...UNO } },
        'tailwind',
        'tailwind.config.ts',
      ],

      // — both config files present: Tailwind's v3 config leads, explicitly —
      [
        'both config files',
        { v3: true, uno: true, deps: { ...TW3, ...UNO } },
        'tailwind',
        'tailwind.config.ts',
      ],

      // — the v4 exception: v4 has no JS config, so a *dep-backed* CSS marker outranks a uno config —
      [
        'uno config vs live v4',
        { uno: true, css: true, deps: { ...UNO, ...TW4 } },
        'tailwind',
        'src/app.css',
      ],
      // — …but an unbacked marker is migration residue, and the uno config wins —
      [
        'uno config vs orphan CSS marker',
        { uno: true, css: true, deps: UNO },
        'unocss',
        'uno.config.ts',
      ],
      // — a leftover *v3* dep is residue too, not proof of a live v4 setup: keeping `tailwindcss`
      //   alive for prettier-plugin-tailwindcss is the signal this cascade already calls residue,
      //   and the CSS marker regex is unanchored enough that a comment can match it —
      [
        'uno config vs CSS marker backed only by a v3 dep',
        { uno: true, css: true, deps: { ...UNO, ...TW3 } },
        'unocss',
        'uno.config.ts',
      ],

      // — a config that loads no vocabulary preset is UnoCSS-for-icons, not a utility-first project.
      //   It must overrule the `unocss` umbrella dependency such a project still installs, which is
      //   why the dependency denylist alone never fixed this shape —
      [
        'icons-only uno config, umbrella dep present',
        { uno: true, deps: UNO, unoVocab: false },
        'unknown',
        undefined,
      ],
      [
        'uno config loading a wind preset',
        { uno: true, deps: UNO, unoVocab: true },
        'unocss',
        'uno.config.ts',
      ],
      // — unreadable presets are not a "no": assume the setup almost every UnoCSS project has —
      ['uno config with unreadable presets', { uno: true, deps: UNO }, 'unocss', 'uno.config.ts'],
      // — and an icons-only config must not fall through to some other framework's evidence —
      [
        'icons-only uno config beside sass',
        { uno: true, deps: { ...UNO, sass: '^1.0.0' }, unoVocab: false },
        'scss',
        undefined,
      ],

      // — packages that generate no utility are not evidence of UnoCSS —
      ['@unocss/reset only', { deps: { '@unocss/reset': '^66.0.0' } }, 'unknown', undefined],
      ['icons-only UnoCSS', { deps: { '@unocss/preset-icons': '^66.0.0' } }, 'unknown', undefined],
      // — but the integrations are, since both default to a wind preset —
      ['@unocss/nuxt', { deps: { '@unocss/nuxt': '^66.0.0' } }, 'unocss', undefined],

      // — a v3 config with no dependency still identifies Tailwind (the file is the stronger signal) —
      ['v3 config, no dep', { v3: true }, 'tailwind', 'tailwind.config.ts'],

      // — sass only ranks once no utility framework is found —
      ['sass alone', { deps: { sass: '^1.0.0' } }, 'scss', undefined],
      ['sass loses to unocss', { deps: { sass: '^1.0.0', ...UNO } }, 'unocss', undefined],
    ];

  for (const [name, signals, system, configPath] of cases) {
    it(`${name} → ${system}${configPath === undefined ? '' : ` (${configPath})`}`, () => {
      const styling = detect(signals);
      expect(styling.system).toBe(system);
      expect(styling.configPath).toBe(configPath);
    });
  }

  it('every row that resolves to a utility framework reports utility-first, and no other row does', () => {
    for (const [name, signals, system] of cases) {
      const styling = detect(signals);
      expect(
        { name, utilityFirst: isUtilityFirst(styling.system) },
        `${name}: utility-first must track the framework, since it decides whether a token's utility base is emitted as a class`,
      ).toEqual({ name, utilityFirst: system === 'tailwind' || system === 'unocss' });
    }
  });
});
