import { describe, expect, it } from 'vitest';
import { detectProfile } from '../src/profile/profile.js';
import { parseUnoConfig } from '../src/tokens/js-config.js';
import { resolveTokenSource } from '../src/tokens/load.js';

const baseInput = (o: any) => ({
  rootDir: '/x', packageJson: null, hasTsconfig: false, presentConfigFiles: [], ...o,
});

describe('scratch', () => {
  it('uno config loses to a bare tailwindcss dep', () => {
    const p = detectProfile(baseInput({
      packageJson: { devDependencies: { unocss: '^66', tailwindcss: '^3.4.0' } },
      presentConfigFiles: ['uno.config.ts'],
    }));
    console.log('STYLING', JSON.stringify(p.styling));
    console.log('SOURCE', JSON.stringify(resolveTokenSource(p, undefined)));
  });

  it('wind4 config with unreadable presets', () => {
    const r = parseUnoConfig('uno.config.ts', `
      import { defineConfig } from 'unocss'
      import { presets } from './shared'
      export default defineConfig({ presets, theme: { colors: { brand: '#111' }, radius: { blob: '14px' }, text: { huge: { fontSize: '48px' } } } })
    `);
    console.log('WIND4-MISSED', JSON.stringify(r));
  });

  it('tailwind config read with uno vocabulary via override', () => {
    const p: any = { styling: { system: 'unocss', configPath: 'uno.config.ts' } };
    console.log('OVERRIDE', JSON.stringify(resolveTokenSource(p, 'packages/ui/tailwind.config.js')));
  });

  it('theme spread of a whole scale is not counted as skipped', () => {
    const r = parseUnoConfig('uno.config.ts', `
      import { defineConfig, presetUno } from 'unocss'
      import colors from './palette'
      export default defineConfig({ presets: [presetUno()], theme: { colors, spacing: { 4: '1rem' } } })
    `);
    console.log('WHOLE-SCALE', JSON.stringify(r));
  });

  it('uno theme.extend is read though UnoCSS has no extend', () => {
    const r = parseUnoConfig('uno.config.ts', `
      import { defineConfig, presetUno } from 'unocss'
      export default defineConfig({ presets: [presetUno()], theme: { extend: { colors: { brand: '#111' } } } })
    `);
    console.log('EXTEND', JSON.stringify(r));
  });
});
