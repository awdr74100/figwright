import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  extractAngularComponents,
  extractReactComponents,
  extractSfcComponent,
  nameFromFile,
  scanComponents,
} from '../../src/scan/scan.js';

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

describe('extractSfcComponent (Vue / Svelte props)', () => {
  it('parses Vue defineProps type form, and marks props as extracted', () => {
    const code =
      '<script setup lang="ts">defineProps<{ size?: string; variant: "a" | "b" }>()</script><template><button/></template>';
    const [c] = extractSfcComponent('ui/Button.vue', code, 'vue');
    expect(c?.name).toBe('Button');
    expect(c?.propNames).toEqual(['size', 'variant']);
    expect(c?.propsExtracted).toBe(true);
  });

  it('parses Vue defineProps object and array forms', () => {
    const obj = extractSfcComponent(
      'C.vue',
      '<script setup>defineProps({ size: String, label: { type: String } })</script>',
      'vue',
    );
    expect(obj[0]?.propNames).toEqual(['size', 'label']);
    const arr = extractSfcComponent(
      'C.vue',
      "<script setup>defineProps(['size', 'tone'])</script>",
      'vue',
    );
    expect(arr[0]?.propNames).toEqual(['size', 'tone']);
  });

  it('handles withDefaults(defineProps<...>()) and a prop-less template', () => {
    const wd = extractSfcComponent(
      'C.vue',
      '<script setup lang="ts">withDefaults(defineProps<{ open: boolean }>(), { open: false })</script>',
      'vue',
    );
    expect(wd[0]?.propNames).toEqual(['open']);
    const none = extractSfcComponent('C.vue', '<template><div/></template>', 'vue');
    expect(none[0]?.propNames).toEqual([]);
    expect(none[0]?.propsExtracted).toBe(true); // script-less = genuinely no props, not "unknown"
  });

  it('parses Svelte export let and $props() runes', () => {
    const four = extractSfcComponent(
      'C.svelte',
      '<script>export let size; export let tone = "x";</script>',
      'svelte',
    );
    expect(four[0]?.propNames.toSorted()).toEqual(['size', 'tone']);
    const five = extractSfcComponent(
      'C.svelte',
      '<script lang="ts">let { size, tone } = $props();</script>',
      'svelte',
    );
    expect(five[0]?.propNames.toSorted()).toEqual(['size', 'tone']);
  });

  it('marks props NOT extracted when the script fails to parse', () => {
    const [c] = extractSfcComponent('C.vue', '<script setup>const = = =</script>', 'vue');
    expect(c?.propsExtracted).toBe(false);
    expect(c?.propNames).toEqual([]);
  });
});

describe('extractAngularComponents (pure)', () => {
  it('extracts classic @Input() props and strips the Component name suffix for matching', () => {
    const code = `
      import { Component, Input } from '@angular/core';
      @Component({ selector: 'app-button', standalone: true, template: '' })
      export class ButtonComponent {
        @Input() size = 'md';
        @Input() disabled = false;
      }
    `;
    const [c] = extractAngularComponents('src/app/button/button.component.ts', code);
    expect(c?.name).toBe('Button'); // ButtonComponent → Button, so it matches a Figma "Button"
    expect(c?.framework).toBe('angular');
    expect(c?.exportKind).toBe('named');
    expect(c?.propNames).toEqual(['size', 'disabled']);
    expect(c?.propsExtracted).toBe(true);
  });

  it('extracts signal inputs (input / input.required / model) alongside decorator inputs', () => {
    const code = `
      import { Component, Input, input, model } from '@angular/core';
      @Component({ selector: 'app-card', template: '' })
      export class CardComponent {
        @Input() elevated = false;
        title = input.required<string>();
        count = input(0);
        selected = model(false);
      }
    `;
    const [c] = extractAngularComponents('card.component.ts', code);
    expect(c?.propNames).toEqual(['elevated', 'title', 'count', 'selected']);
  });

  it('does not mistake internal signals / queries / outputs for inputs', () => {
    // Only input()/model() (and @Input) are public inputs. signal()/computed() are internal state,
    // viewChild()/contentChild() are queries, output() is an event — none is a component prop.
    const code = `
      import { Component, signal, computed, input, output, viewChild } from '@angular/core';
      @Component({ selector: 'app-widget', template: '' })
      export class WidgetComponent {
        label = input('');
        count = signal(0);
        doubled = computed(() => this.count() * 2);
        changed = output<number>();
        ref = viewChild('el');
      }
    `;
    const [c] = extractAngularComponents('widget.component.ts', code);
    expect(c?.propNames).toEqual(['label']); // not count / doubled / changed / ref
  });

  it('uses the @Input alias (string and object form) as the public prop name', () => {
    const code = `
      import { Component, Input } from '@angular/core';
      @Component({ template: '' })
      export class FieldComponent {
        @Input('variant') kind = 'primary';
        @Input({ alias: 'isBusy', required: true }) busy!: boolean;
        @Input() set active(v: boolean) {}
      }
    `;
    const [c] = extractAngularComponents('field.component.ts', code);
    // The alias is the template-binding name (what a Figma axis lines up against); set-accessor
    // inputs are captured too.
    expect(c?.propNames).toEqual(['variant', 'isBusy', 'active']);
  });

  it('skips non-component classes (@Injectable / @Directive / plain) and anonymous classes', () => {
    const code = `
      import { Injectable, Directive } from '@angular/core';
      @Injectable() export class DataService {}
      @Directive({ selector: '[appHi]' }) export class HiDirective {}
      export class PlainThing {}
    `;
    expect(extractAngularComponents('x.ts', code)).toEqual([]);
  });

  it('does not crash on unparseable source', () => {
    expect(extractAngularComponents('x.ts', 'export class = = =')).toEqual([]);
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
    // vendored files must be ignored — node_modules and a PHP-style vendor/ (even when they hold a
    // matching .tsx). vendor/ is the case a post-filter alone wouldn't help: it's pruned at the walk.
    await mkdir(join(dir, 'node_modules', 'pkg'), { recursive: true });
    await writeFile(join(dir, 'node_modules', 'pkg', 'Evil.tsx'), 'export function Evil() {}');
    await mkdir(join(dir, 'vendor', 'pkg'), { recursive: true });
    await writeFile(join(dir, 'vendor', 'pkg', 'Vendored.tsx'), 'export function Vendored() {}');
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('finds components across heterogeneous folders and skips node_modules + vendor', async () => {
    const comps = await scanComponents(dir, ['.tsx', '.jsx']);
    const names = comps.map(c => c.name).toSorted();
    expect(names).toEqual(['Button', 'CartItem']); // not Evil (node_modules) or Vendored (vendor)
    expect(comps.every(c => !/node_modules|vendor/.test(c.filePath))).toBe(true);
  });

  // Regression: a single-extension profile (Vue/Svelte) must not be silently dropped by a
  // single-element brace pattern that Node's glob refuses to expand (`**/*{.vue}` → no matches).
  it('finds components for a single-extension profile (Vue filename baseline)', async () => {
    const vueDir = await mkdtemp(join(tmpdir(), 'scan-vue-'));
    try {
      await mkdir(join(vueDir, 'src', 'components'), { recursive: true });
      await writeFile(
        join(vueDir, 'src', 'components', 'Button.vue'),
        '<script setup lang="ts">defineProps<{ size?: string }>()</script><template><button/></template>',
      );
      const comps = await scanComponents(vueDir, ['.vue']);
      expect(comps.map(c => c.name)).toEqual(['Button']);
      expect(comps[0]?.framework).toBe('vue');
      // The Vue SFC's defineProps<{ size?: string }>() is parsed, not just the filename baseline.
      expect(comps[0]?.propNames).toEqual(['size']);
      expect(comps[0]?.propsExtracted).toBe(true);
    } finally {
      await rm(vueDir, { recursive: true, force: true });
    }
  });

  // An Angular profile globs .ts: only @Component classes are kept, and a service .ts in the same
  // sweep contributes nothing (so the scan isn't polluted by every .ts in the repo).
  it('scans an Angular .ts profile, keeping @Component classes and skipping services', async () => {
    const ngDir = await mkdtemp(join(tmpdir(), 'scan-ng-'));
    try {
      await mkdir(join(ngDir, 'src', 'app', 'button'), { recursive: true });
      await writeFile(
        join(ngDir, 'src', 'app', 'button', 'button.component.ts'),
        `import { Component, input } from '@angular/core';
         @Component({ selector: 'app-button', template: '' })
         export class ButtonComponent { size = input('md'); }`,
      );
      await writeFile(
        join(ngDir, 'src', 'app', 'data.service.ts'),
        `import { Injectable } from '@angular/core';
         @Injectable() export class DataService {}`,
      );
      const comps = await scanComponents(ngDir, ['.ts']);
      expect(comps.map(c => c.name)).toEqual(['Button']); // not DataService
      expect(comps[0]?.framework).toBe('angular');
      expect(comps[0]?.propNames).toEqual(['size']);
    } finally {
      await rm(ngDir, { recursive: true, force: true });
    }
  });
});
