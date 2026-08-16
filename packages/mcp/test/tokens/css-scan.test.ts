import { describe, expect, it } from 'vitest';

import { scanCustomProperties, scanScssVariables } from '../../src/tokens/css-scan.js';

/** Compact assertion helper: `name=value` per declaration, in scan order. */
const pairs = (css: string): string[] => scanCustomProperties(css).map(d => `${d.name}=${d.value}`);

describe('scanCustomProperties', () => {
  it('reads declarations with their block chain', () => {
    const decls = scanCustomProperties('@media (min-width: 60rem) { .card { --pad: 8px; } }');
    expect(decls).toEqual([
      { name: 'pad', value: '8px', scope: '.card', ancestors: ['@media (min-width: 60rem)'] },
    ]);
  });

  it('keeps same-named declarations from different blocks apart', () => {
    const decls = scanCustomProperties(':root { --bg: #FFF; } .dark { --bg: #000; }');
    expect(decls.map(d => [d.scope, d.value])).toEqual([
      [':root', '#FFF'],
      ['.dark', '#000'],
    ]);
  });

  // The regression this scanner exists for: minified CSS has no semicolon before `}`, and the old
  // `[^;]+;` pattern swallowed the brace and everything after it.
  it('terminates the last declaration of a block at the closing brace', () => {
    expect(pairs('.a{--x:100%}@media (min-width:768px){.b{--x:112.5%}}')).toEqual([
      'x=100%',
      'x=112.5%',
    ]);
  });

  it('does not treat a semicolon inside a string as a terminator', () => {
    expect(pairs(':root { --sep: "a;b"; --after: #FF0000; }')).toEqual([
      'sep="a;b"',
      'after=#FF0000',
    ]);
  });

  it('does not treat a semicolon inside url() as a terminator', () => {
    expect(pairs(':root { --u: url(http://x/y;z.png); --after: 1px; }')).toEqual([
      'u=url(http://x/y;z.png)',
      'after=1px',
    ]);
  });

  it('does not mistake comment syntax inside a string for a comment', () => {
    expect(pairs(':root { --url: url("http://x/*y*/z.png"); --after: #0F0; }')).toEqual([
      'url=url("http://x/*y*/z.png")',
      'after=#0F0',
    ]);
  });

  it('skips real comments, including ones holding declaration-shaped text', () => {
    expect(pairs(':root { /* c */ --a: 1px; /* --fake: 2px; */ --b: 2px; }')).toEqual([
      'a=1px',
      'b=2px',
    ]);
  });

  it('ignores var() usages, which are not declarations', () => {
    expect(pairs('.x { color: var(--nope); --real: 1px; }')).toEqual(['real=1px']);
  });

  it('ignores a var() usage that is not followed by a semicolon', () => {
    expect(pairs('.x { color: var(--nope) } .y { --real: 1px; }')).toEqual(['real=1px']);
  });

  it('handles a closing brace inside a string value', () => {
    expect(pairs('.a { --brace: "}"; --after: 1px; }')).toEqual(['brace="}"', 'after=1px']);
  });

  it('handles escaped quotes in a value', () => {
    expect(pairs(':root { --q: "he said \\"hi\\""; --after: 1px; }')).toEqual([
      'q="he said \\"hi\\""',
      'after=1px',
    ]);
  });

  it('handles a semicolon inside an attribute selector', () => {
    const decls = scanCustomProperties('[data-theme="dark;x"] { --a: 1px; }');
    expect(decls.map(d => [d.scope, d.name])).toEqual([['[data-theme="dark;x"]', 'a']]);
  });

  it('strips !important without disturbing the value', () => {
    expect(pairs(':root { --a: 1px !important; --b: 2px!important; }')).toEqual(['a=1px', 'b=2px']);
  });

  it('skips empty values', () => {
    expect(pairs(':root { --a:; --b: 1px; }')).toEqual(['b=1px']);
  });

  it('tracks nested CSS blocks', () => {
    const decls = scanCustomProperties('.card { --pad: 4px; &:hover { --pad: 8px; } }');
    expect(decls.map(d => [d.scope, d.ancestors, d.value])).toEqual([
      ['.card', [], '4px'],
      ['&:hover', ['.card'], '8px'],
    ]);
  });

  it('reads declarations directly inside an at-rule block', () => {
    const decls = scanCustomProperties('@theme { --color-a: #111; }');
    expect(decls).toEqual([{ name: 'color-a', value: '#111', scope: '@theme', ancestors: [] }]);
  });

  it('normalizes whitespace in a multi-line prelude', () => {
    const decls = scanCustomProperties('.a,\n  .b {\n  --x: 1px;\n}');
    expect(decls[0]?.scope).toBe('.a, .b');
  });

  it('ignores a statement at-rule that has no block', () => {
    expect(pairs('@import url("a.css");\n:root { --a: 1px; }')).toEqual(['a=1px']);
  });

  it('ignores custom properties outside any block', () => {
    expect(pairs('--stray: 1px;\n:root { --a: 1px; }')).toEqual(['a=1px']);
  });

  it('preserves multi-part and functional values verbatim', () => {
    expect(pairs(':root { --s: 0 1px 2px rgba(0,0,0,.4); --b: oklch(0.6 0.2 270); }')).toEqual([
      's=0 1px 2px rgba(0,0,0,.4)',
      'b=oklch(0.6 0.2 270)',
    ]);
  });

  it('handles a data URI whose value contains a semicolon', () => {
    expect(pairs(':root { --img: url(data:image/svg+xml;base64,AAA=); --after: 1px; }')).toEqual([
      'img=url(data:image/svg+xml;base64,AAA=)',
      'after=1px',
    ]);
  });

  it('is unaffected by a leading BOM', () => {
    // No BOM-specific branch is needed: U+FEFF is WhiteSpace per the ES spec, so the `trim()` that
    // normalizes every prelude already drops it. Asserted on the scope because that is the only
    // place a stray BOM could surface \u2014 the declaration parses either way.
    const decls = scanCustomProperties('\uFEFF:root { --a: 1px; }');
    expect(decls[0]?.scope).toBe(':root');
  });

  // Malformed input degrades instead of throwing: this reads other people's repositories, where a
  // truncated vendored stylesheet must not fail the whole grounding call.
  it('does not throw on an unterminated string', () => {
    // The truncated value is surfaced as far as it was read rather than dropped — consistent with
    // reading as much as the input allows. A value like this matches nothing on the Figma side, so
    // the join filters it out without needing this layer to judge completeness.
    expect(pairs(':root { --a: 1px; --b: "unterminated')).toEqual(['a=1px', 'b="unterminated']);
  });

  it('does not throw on an unterminated comment', () => {
    expect(pairs(':root { --a: 1px; } /* unterminated')).toEqual(['a=1px']);
  });

  it('does not throw on unbalanced braces', () => {
    expect(pairs('.a { --x: 1px; }}} .b { --y: 2px; }')).toEqual(['x=1px', 'y=2px']);
  });

  it('returns nothing for an empty stylesheet', () => {
    expect(scanCustomProperties('')).toEqual([]);
  });
});

describe('scanScssVariables', () => {
  /** `name=value` per declaration, in scan order. */
  const flat = (scss: string): string[] => scanScssVariables(scss).map(d => `${d.name}=${d.value}`);

  it('reads top-level declarations and strips the declaration flags', () => {
    // `!default` marks a variable overridable and `!global` lets a scoped one escape; neither is
    // part of the value, and keeping them would make a token compare unequal to its plain twin.
    expect(flat('$a: #6266F0;\n$b: 8px !default;\n$c: 4px !global;')).toEqual([
      'a=#6266F0',
      'b=8px',
      'c=4px',
    ]);
  });

  it('skips // line comments, which CSS does not have', () => {
    // The whole reason the scanner is dialect-aware rather than shared verbatim.
    expect(flat('// $fake: 1px;\n$real: 2px; // trailing $alsoFake: 3px;')).toEqual(['real=2px']);
  });

  it('does not let a brace inside a // comment open a block', () => {
    // The case that actually distinguishes the dialects. Prose in comments contains braces, and
    // read as structure the `{` opens a block that never closes — every later declaration is then
    // tagged with a bogus scope, and the caller drops it as rule-scoped. The variable disappears.
    const decls = scanScssVariables('// TODO: handle the { } case\n$after: 1px;');
    expect(decls.map(d => [d.name, d.scope])).toEqual([['after', '']]);
  });

  it('keeps a value whose commas and semicolons are inside parens or strings', () => {
    expect(flat('$s: 0 1px rgba(0,0,0,.1), 0 4px rgba(0,0,0,.2);')).toEqual([
      's=0 1px rgba(0,0,0,.1), 0 4px rgba(0,0,0,.2)',
    ]);
    expect(flat('$u: url("http://a/b;c.png");')).toEqual(['u=url("http://a/b;c.png")']);
    expect(flat('$m: (primary: #fff, teal: #000);')).toEqual(['m=(primary: #fff, teal: #000)']);
  });

  it('does not mistake a variable *reference* for a declaration', () => {
    // The prelude guard: at `$a` the prelude holds `color: `, so it is a use, not a declaration.
    expect(flat('.x { color: $a; }')).toEqual([]);
    // A mixin's default argument is a parameter, not a module-level variable.
    expect(flat('@mixin m($arg: 10px) { margin: $arg; }')).toEqual([]);
  });

  it('tags a variable declared inside a rule with that rule as its scope', () => {
    // Such a variable is local to the block and referencing it elsewhere does not compile, so the
    // caller drops it — this layer only records where it was found.
    const decls = scanScssVariables('$top: 1px;\n.card { $inner: 2px; }');
    expect(decls.map(d => [d.name, d.scope])).toEqual([
      ['top', ''],
      ['inner', '.card'],
    ]);
  });

  it('degrades on malformed input rather than throwing', () => {
    expect(() => scanScssVariables('$a: (unclosed')).not.toThrow();
    expect(() => scanScssVariables('/* unterminated')).not.toThrow();
    expect(scanScssVariables('')).toEqual([]);
  });
});
