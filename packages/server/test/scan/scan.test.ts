import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { extractReactComponents, nameFromFile, scanComponents } from '../../src/scan/scan.js';

describe('extractReactComponents (pure)', () => {
  it('finds named function + arrow components and their destructured props', () => {
    const code = `
      export function Button({ size, variant }) { return <button/>; }
      export const Card = ({ title }) => <div>{title}</div>;
    `;
    const comps = extractReactComponents('ui/Button.tsx', code);
    const button = comps.find(c => c.name === 'Button');
    const card = comps.find(c => c.name === 'Card');
    expect(button?.propNames).toEqual(['size', 'variant']);
    expect(button?.exportKind).toBe('named');
    expect(card?.propNames).toEqual(['title']);
  });

  it('excludes non-component exports (non-PascalCase / non-function)', () => {
    const code = `
      export const API_URL = 'x';
      export const useThing = () => 1;
      function helper() {}
      export { helper };
    `;
    expect(extractReactComponents('x.tsx', code)).toEqual([]);
  });

  it('unwraps forwardRef/memo HOCs', () => {
    const code = `
      import { forwardRef, memo } from 'react';
      export const Icon = forwardRef((props, ref) => <svg ref={ref}/>);
      export const Badge = memo(({ label }) => <span>{label}</span>);
    `;
    const names = extractReactComponents('x.tsx', code)
      .map(c => c.name)
      .toSorted();
    expect(names).toEqual(['Badge', 'Icon']);
  });

  it('names an anonymous default export from the filename', () => {
    const comps = extractReactComponents(
      'components/UserCard.tsx',
      'export default function() { return <div/>; }',
    );
    expect(comps[0]?.name).toBe('UserCard');
    expect(comps[0]?.exportKind).toBe('default');
  });

  it('does not crash on unparseable source', () => {
    expect(extractReactComponents('x.tsx', 'export const = = =')).toEqual([]);
  });
});

describe('nameFromFile', () => {
  it('PascalCases kebab and uses parent dir for index files', () => {
    expect(nameFromFile('ui/user-card.tsx')).toBe('UserCard');
    expect(nameFromFile('components/Button/index.tsx')).toBe('Button');
    expect(nameFromFile('a/b/data_table.vue')).toBe('DataTable');
  });
});

describe('scanComponents (real fs)', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'scan-test-'));
    // components live in different folder shapes — none of which we hardcode
    await mkdir(join(dir, 'src', 'components', 'ui'), { recursive: true });
    await mkdir(join(dir, 'src', 'features', 'cart'), { recursive: true });
    await writeFile(
      join(dir, 'src', 'components', 'ui', 'Button.tsx'),
      'export function Button({ size }) { return <button/>; }',
    );
    await writeFile(
      join(dir, 'src', 'features', 'cart', 'cart-item.tsx'),
      'export default function CartItem() { return <li/>; }',
    );
    // vendored file must be ignored
    await mkdir(join(dir, 'node_modules', 'pkg'), { recursive: true });
    await writeFile(join(dir, 'node_modules', 'pkg', 'Evil.tsx'), 'export function Evil() {}');
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('finds components across heterogeneous folders and skips node_modules', async () => {
    const comps = await scanComponents(dir, ['.tsx', '.jsx']);
    const names = comps.map(c => c.name).toSorted();
    expect(names).toEqual(['Button', 'CartItem']);
    expect(comps.every(c => !c.filePath.includes('node_modules'))).toBe(true);
  });
});
