import { describe, expect, it } from 'vitest';

import { parseScssFile } from '../../src/tokens/scss-file.js';
import { parseCssCustomProperties, parseScssVariables } from '../../src/tokens/tokens.js';

describe('parseCssCustomProperties', () => {
  it('parses Tailwind v4 @theme tokens with utility base + category', () => {
    const css = `@theme {
      --color-primary-500: #6266F0;
      --radius-lg: 0.5rem;
      --font-weight-bold: 700;
    }`;
    const tokens = parseCssCustomProperties(css);
    const primary = tokens.find(t => t.name === 'color-primary-500');
    expect(primary).toMatchObject({
      value: '#6266F0',
      cssVar: 'var(--color-primary-500)',
      utility: 'primary-500',
      category: 'color',
    });
    expect(tokens.find(t => t.name === 'radius-lg')?.utility).toBe('lg');
    // font-weight- must win over font-
    expect(tokens.find(t => t.name === 'font-weight-bold')?.category).toBe('font-weight');
  });

  it('parses plain :root CSS vars with no utility/category', () => {
    const tokens = parseCssCustomProperties(':root { --primary-500: #6266F0; --gap: 8px; }');
    const t = tokens.find(x => x.name === 'primary-500');
    expect(t?.cssVar).toBe('var(--primary-500)');
    expect(t?.utility).toBeUndefined();
    expect(t?.category).toBeUndefined();
  });

  it('ignores commented-out declarations', () => {
    const css = `:root { --color-x: #111; }
      /* --color-x: #999; should be ignored (commented) */`;
    const tokens = parseCssCustomProperties(css);
    expect(tokens.filter(t => t.name === 'color-x')).toHaveLength(1);
    expect(tokens.find(t => t.name === 'color-x')?.value).toBe('#111');
  });

  it('keeps every distinct value of a repeated name, @theme leading', () => {
    const css = `:root { --color-x: #111; }
      @theme { --color-x: #222; }`;
    const tokens = parseCssCustomProperties(css).filter(t => t.name === 'color-x');
    // Both are real values the project declares; collapsing them is what used to make a light
    // theme's colors unmatchable once a dark theme redeclared them.
    expect(tokens.map(t => t.value)).toEqual(['#222', '#111']);
  });

  it('leads with the base :root value rather than a theme override', () => {
    const css = `:root { --bg: #FFFFFF; }
      .dark { --bg: #000000; }
      @media (prefers-color-scheme: dark) { :root { --bg: #010101; } }`;
    const tokens = parseCssCustomProperties(css).filter(t => t.name === 'bg');
    // The unconditional :root leads; the class override and the media-nested :root follow in
    // document order — a :root inside @media is an override, not the base declaration.
    expect(tokens.map(t => t.value)).toEqual(['#FFFFFF', '#000000', '#010101']);
  });

  it('keeps a @theme name utility-first across its theme overrides', () => {
    // The two entries are one token kept twice so the value-match join can recognise either value.
    // Deciding "does this generate a class" per declaration made the `.dark` one utility-less, so
    // the same token resolved to `surface` for its light value and `var(--color-surface)` for its
    // dark one — two contradictory refs, reachable inside a single grounding payload.
    const css = `@theme { --color-surface: #FFFFFF; }
      .dark { --color-surface: #0A0A0A; }`;
    const tokens = parseCssCustomProperties(css).filter(t => t.name === 'color-surface');
    expect(tokens.map(t => t.value)).toEqual(['#FFFFFF', '#0A0A0A']);
    expect(tokens.map(t => t.utilityIsClass)).toEqual([true, true]);
  });

  it('does not mark a namespace-shaped name outside @theme as a class', () => {
    // `utility` is derived from the name, so a loose custom property gets one — but nothing
    // generates `bg-brand` from `:root { --color-brand }`.
    const [token] = parseCssCustomProperties(':root { --color-brand: #6266F0; }');
    expect(token?.utility).toBe('brand');
    expect(token?.utilityIsClass).toBeUndefined();
  });

  it('collapses a name+value repeated across blocks', () => {
    const css = ':root { --a: 1px; } .x { --a: 1px; } .y { --a: 2px; }';
    const tokens = parseCssCustomProperties(css).filter(t => t.name === 'a');
    // Same value in three places is one token — reporting it twice would make token_map call it
    // ambiguous with itself.
    expect(tokens.map(t => t.value)).toEqual(['1px', '2px']);
  });
});

describe('parseScssVariables', () => {
  it('emits the reference with its sigil and the file that declares it', () => {
    // `from` is not decoration: `$color-primary-500` is an undefined-variable error until the
    // consuming file @uses this path, and how that @use is written decides the ref's final form.
    expect(parseScssVariables('$color-primary-500: #6266F0;', 'src/_tokens.scss')).toEqual([
      {
        name: 'color-primary-500',
        value: '#6266F0',
        scssVar: '$color-primary-500',
        from: 'src/_tokens.scss',
      },
    ]);
  });

  it('drops a variable scoped to a rule, which cannot be referenced from elsewhere', () => {
    // Sass scopes it to the block; emitting it would hand codegen a compile error, not a style nit.
    const tokens = parseScssVariables('$top: 1px;\n.card { $inner: 2px; }', 'a.scss');
    expect(tokens.map(t => t.name)).toEqual(['top']);
  });

  it('derives no utility or category, because SCSS generates no classes', () => {
    // A namespace-shaped name would otherwise put `bg-primary-500` back into circulation on a
    // project that has no such class.
    const [t] = parseScssVariables('$color-primary-500: #6266F0;', 'a.scss');
    expect(t?.utility).toBeUndefined();
    expect(t?.category).toBeUndefined();
    expect(t?.utilityIsClass).toBeUndefined();
  });

  it('drops a private variable, which no other file can reference', () => {
    // Sass treats a leading `-` or `_` as private: the member is not exported, and @use-ing the
    // file and naming it is an error. Bootstrap's `$_luminance-list` is one. Found by differential
    // against dart-sass's own meta.module-variables() over real repositories.
    expect(parseScssVariables('$_private: 1px;\n$-also: 2px;\n$public: 3px;', 'a.scss')).toEqual([
      { name: 'public', value: '3px', scssVar: '$public', from: 'a.scss' },
    ]);
  });

  it('does not let interpolation in a selector make a scoped variable look module-level', () => {
    // `.table-#{$state} { … }` — the interpolation's braces are not block braces. Read as
    // structure they open and close a phantom block, leaving the real rule's contents looking
    // top-level: Bootstrap's mixin-local `$color` was emitted as a project token, and a ref to it
    // compiles nowhere.
    const tokens = parseScssVariables(
      '@mixin v($state) {\n  .table-#{$state} {\n    $color: red;\n  }\n}\n$real: 1px;',
      'a.scss',
    );
    expect(tokens.map(t => t.name)).toEqual(['real']);
  });

  it('keeps one entry per distinct value of a repeated name', () => {
    // Same rule as the CSS parser: a `!default` override contributes a second real value, while an
    // exact repeat collapses so the join cannot call a token ambiguous with itself.
    const tokens = parseScssVariables('$c: #111;\n$c: #111;\n$c: #222;', 'a.scss');
    expect(tokens.map(t => t.value)).toEqual(['#111', '#222']);
  });
});

describe('parseScssFile', () => {
  it('collapses the mirror in its idiomatic interpolated form', () => {
    // `--brand: #{$brand}` is how the mirror is actually written. The custom property's value is
    // the literal text `#{$brand}`, so a repo-wide name+value fold never fired for it — only for
    // the literal spelling, which is what the tests used. Resolved against the file's own
    // variables it becomes one token with the ref that needs no import.
    expect(parseScssFile('$brand: #6266F0;\n:root { --brand: #{$brand}; }', 'f.scss')).toEqual([
      { name: 'brand', value: '#6266F0', cssVar: 'var(--brand)' },
    ]);
  });

  it('keeps a variable the file does not mirror', () => {
    const tokens = parseScssFile('$a: #111111;\n:root { --b: #222222; }', 'f.scss');
    expect(tokens.map(t => [t.name, t.scssVar ?? t.cssVar])).toEqual([
      ['a', '$a'],
      ['b', 'var(--b)'],
    ]);
  });

  it('drops a custom property declared inside a mixin body', () => {
    // It only exists wherever the mixin is included, so `var(--brand)` resolves to nothing in a
    // component that never includes it — the asymmetric twin of the rule-scoped `$var` case.
    expect(parseScssFile('@mixin theme { --brand: #6266F0; }\n$real: 1px;', 'f.scss')).toEqual([
      { name: 'real', value: '1px', scssVar: '$real', from: 'f.scss' },
    ]);
  });
});
