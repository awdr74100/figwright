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
    const comps = extractReactComponents('x.tsx', code);
    expect(comps.map(c => c.name).toSorted()).toEqual(['Badge', 'Icon']);
    // Icon takes an un-annotated `props` param: its prop list is unknowable, and saying so is the
    // whole point of propsExtracted. Asserting only the names here is what let a false
    // propsExtracted=true survive — the join then reports every Figma axis as a missing prop.
    expect(comps.find(c => c.name === 'Icon')?.propsExtracted).toBe(false);
    expect(comps.find(c => c.name === 'Badge')?.propNames).toEqual(['label']);
  });

  it('unwraps namespaced and nested HOCs (React.memo, memo(forwardRef(...)))', () => {
    const code = `
      export const Icon = React.memo(({ size }) => <svg/>);
      export const Chip = React.forwardRef(({ tone }, ref) => <span ref={ref}/>);
      export const Tag = memo(forwardRef(({ label }, ref) => <b ref={ref}/>));
    `;
    const comps = extractReactComponents('x.tsx', code);
    expect(comps.map(c => c.name).toSorted()).toEqual(['Chip', 'Icon', 'Tag']);
    expect(comps.find(c => c.name === 'Tag')?.propNames).toEqual(['label']);
  });

  it('resolves components exported by reference, not just inline declarations', () => {
    // Declaring at the top and exporting at the bottom is a common house style; a scanner that only
    // reads `export const` reports these as absent and codegen rebuilds components that exist.
    const code = `
      interface Props { size?: string }
      const Button = ({ size }: Props) => <button/>;
      function Card({ title }: { title: string }) { return <div/>; }
      const Inner = ({ tone }: { tone: string }) => <i/>;
      export { Button, Card, Inner as Badge };
      export default Button;
    `;
    const comps = extractReactComponents('ui/Button.tsx', code);
    expect(comps.map(c => c.name).toSorted()).toEqual(['Badge', 'Button', 'Card']);
    expect(comps.find(c => c.name === 'Badge')?.propNames).toEqual(['tone']);
    // Button is exported both ways — it must be reported once, not duplicated.
    expect(comps.filter(c => c.name === 'Button')).toHaveLength(1);
  });

  it('names a default-exported binding after the binding, not the file', () => {
    const code = `const Button = ({ size }: { size?: string }) => <button/>;\nexport default Button;`;
    const [c] = extractReactComponents('ui/index.tsx', code);
    expect(c?.name).toBe('Button'); // the author's name beats the filename baseline (`Ui`)
    expect(c?.exportKind).toBe('default');
    expect(c?.propNames).toEqual(['size']);
  });

  it('ignores type-only exports and re-exports from other modules', () => {
    // `export { Button } from './Button'` is a barrel: that file's own scan reports the component,
    // so counting it here would attribute it to the wrong path.
    const code = `
      interface Props { size?: string }
      export type { Props };
      export { Button } from './Button';
    `;
    expect(extractReactComponents('index.tsx', code)).toEqual([]);
  });

  it('extracts class components and their props', () => {
    const code = `
      interface Props { size?: string; tone: string }
      export class Button extends React.Component<Props> { render() { return <button/>; } }
      export class Chip extends PureComponent<{ label: string }> { render() { return <b/>; } }
      export class NotAComponent extends Base { }
    `;
    const comps = extractReactComponents('x.tsx', code);
    expect(comps.map(c => c.name).toSorted()).toEqual(['Button', 'Chip']);
    expect(comps.find(c => c.name === 'Button')?.propNames.toSorted()).toEqual(['size', 'tone']);
    expect(comps.find(c => c.name === 'Chip')?.propNames).toEqual(['label']);
  });

  // Only the destructured form was read before, so `(props: Props)` — and any component that
  // destructures in its body — reported zero props while claiming the list was complete.
  it.each([
    ['a plain annotated parameter', `export const Button = (props: Props) => <button/>;`],
    [
      'a body destructure',
      `export function Button(props: Props) { const { size } = props; return <button/>; }`,
    ],
    ['React.FC on the binding', `export const Button: React.FC<Props> = (props) => <button/>;`],
    ['FC on a binding that ignores them', `export const Button: FC<Props> = () => <button/>;`],
  ])('reads props declared via %s', (_label, form) => {
    const code = `interface Props { size?: string; tone: string }\n${form}`;
    const [c] = extractReactComponents('x.tsx', code);
    expect(c?.propNames.toSorted()).toEqual(['size', 'tone']);
    expect(c?.propsExtracted).toBe(true);
  });

  it('resolves type aliases, intersections and interface inheritance declared in the file', () => {
    const code = `
      interface Base { tone: string }
      interface Props extends Base { size?: string }
      type Extra = { id: string };
      type CardProps = Extra & { title: string };
      export const Button = (props: Props) => <button/>;
      export const Card = (props: CardProps) => <div/>;
    `;
    const comps = extractReactComponents('x.tsx', code);
    expect(comps.find(c => c.name === 'Button')?.propNames.toSorted()).toEqual(['size', 'tone']);
    expect(comps.find(c => c.name === 'Card')?.propNames.toSorted()).toEqual(['id', 'title']);
  });

  // The honesty invariant: an imported prop type, or an interface extending one, leaves props we
  // genuinely cannot see. Claiming [] would make the join report every Figma axis as missing.
  it.each([
    [
      'imported prop type',
      `import type { Props } from './t';\nexport const Button = (props: Props) => <button/>;`,
    ],
    [
      'interface extending an imported one',
      `import type { Base } from './t';\ninterface Props extends Base { size?: string }\nexport const Button = (props: Props) => <button/>;`,
    ],
    [
      'intersection with an imported type',
      `import type { Base } from './t';\ntype Props = Base & { size?: string };\nexport const Button = (props: Props) => <button/>;`,
    ],
    // A utility generic changes the member set in ways this pass doesn't model.
    [
      'a utility generic',
      `interface Base { size?: string }\nexport const Button = (props: Partial<Base>) => <button/>;`,
    ],
    ['an un-annotated parameter', `export const Button = (props) => <button/>;`],
  ])('reports props as NOT extracted for %s', (_label, code) => {
    const [c] = extractReactComponents('x.tsx', code);
    expect(c?.name).toBe('Button');
    expect(c?.propsExtracted).toBe(false);
    expect(c?.propNames).toEqual([]);
  });

  it('resolves a generic component type but not a utility type', () => {
    // `Props<T>` still declares the same member names — only their types depend on T — so it must
    // resolve. `Partial<Props>` / `Omit<…>` genuinely reshape the member set and must not.
    const generic = `interface Props<T> { items: T[]; size?: string }\nexport const List = <T,>({ items }: Props<T>) => <ul/>;`;
    const [g] = extractReactComponents('x.tsx', generic);
    expect(g?.propNames.toSorted()).toEqual(['items', 'size']);
    expect(g?.propsExtracted).toBe(true);

    const utility = `interface Props { size?: string }\nexport const B = (p: Omit<Props, 'size'>) => <i/>;`;
    expect(extractReactComponents('x.tsx', utility)[0]?.propsExtracted).toBe(false);
  });

  it('prefers the declared prop type over what the body destructures', () => {
    // `({ size }: Props)` accepts every member of Props; treating the pattern as the answer would
    // report the rest as props the component is missing.
    const code = `interface Props { size?: string; tone?: string }\nexport const B = ({ size }: Props) => <i/>;`;
    const [c] = extractReactComponents('x.tsx', code);
    expect(c?.propNames.toSorted()).toEqual(['size', 'tone']);
  });

  it('treats a rest-only pattern as unknown, not as prop-less', () => {
    // `({ ...rest })` has real props, just none written down anywhere readable.
    const [c] = extractReactComponents('x.tsx', 'export const B = ({ ...rest }) => <i/>;');
    expect(c?.propsExtracted).toBe(false);
    // …unless the annotation says what they are.
    const typed = `interface Props { size?: string }\nexport const B = ({ ...rest }: Props) => <i/>;`;
    expect(extractReactComponents('x.tsx', typed)[0]?.propNames).toEqual(['size']);
  });

  it('resolves `export { X as default }` as a default export', () => {
    // Naming it "default" would fail the PascalCase gate and drop the component entirely.
    const code = `const Button = ({ size }: { size?: string }) => <button/>;\nexport { Button as default };`;
    const [c] = extractReactComponents('ui/Button.tsx', code);
    expect(c?.name).toBe('Button');
    expect(c?.exportKind).toBe('default');
    expect(c?.propNames).toEqual(['size']);
  });

  it('reads props of a Solid component, which never destructures them', () => {
    // Destructuring breaks Solid's reactivity, so idiomatic Solid always takes `props` whole —
    // exactly the shape that used to report zero props while claiming the list was complete.
    const P = 'interface Props { size?: string; tone?: string }\n';
    const [fn] = extractReactComponents(
      'x.tsx',
      `${P}export function Button(props: Props) { return <b>{props.size}</b>; }`,
    );
    expect(fn?.propNames.toSorted()).toEqual(['size', 'tone']);
    expect(fn?.propsExtracted).toBe(true);
    // Solid's own component types are the FC<Props> equivalent.
    const [typed] = extractReactComponents(
      'x.tsx',
      `${P}export const Button: ParentComponent<Props> = (props) => <b/>;`,
    );
    expect(typed?.propNames.toSorted()).toEqual(['size', 'tone']);
  });

  it('treats a component with no parameter as genuinely prop-less', () => {
    const [c] = extractReactComponents('x.tsx', 'export const Button = () => <button/>;');
    expect(c?.propNames).toEqual([]);
    expect(c?.propsExtracted).toBe(true); // [] here means "none", not "unknown"
  });

  it('does not mistake a cyclic type for an unreadable one', () => {
    const code = `
      interface A extends B { a?: string }
      interface B extends A { b?: string }
      export const Button = (props: A) => <button/>;
    `;
    const [c] = extractReactComponents('x.tsx', code);
    expect(c?.propNames.toSorted()).toEqual(['a', 'b']);
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

  it('distinguishes a script-less template from a script it could not delimit', () => {
    // Both yield zero script blocks, but they mean opposite things: one genuinely declares no
    // props, the other has props we failed to read.
    const [template] = extractSfcComponent('C.vue', '<template><button/></template>', 'vue');
    expect(template?.propsExtracted).toBe(true);

    const [unclosed] = extractSfcComponent(
      'C.vue',
      '<script setup lang="ts">defineProps<{ size?: string }>()',
      'vue',
    );
    expect(unclosed?.propsExtracted).toBe(false);
  });

  // `defineProps<Props>()` — with an interface and withDefaults — is the dominant Vue authoring
  // style. Reading only the inline literal form missed it, leaving prop-less components.
  it.each([
    ['an interface', `interface Props { size?: string }\ndefineProps<Props>()`],
    ['a type alias', `type Props = { size?: string }\ndefineProps<Props>()`],
    [
      'withDefaults',
      `interface Props { size?: string }\nwithDefaults(defineProps<Props>(), { size: 'md' })`,
    ],
    ['an assigned result', `interface Props { size?: string }\nconst props = defineProps<Props>()`],
  ])('resolves defineProps declared with %s', (_label, body) => {
    const [c] = extractSfcComponent('C.vue', `<script setup lang="ts">${body}</script>`, 'vue');
    expect(c?.propNames).toEqual(['size']);
    expect(c?.propsExtracted).toBe(true);
  });

  it('folds inherited interface members into Vue props', () => {
    const code = `<script setup lang="ts">
      interface Base { tone: string }
      interface Props extends Base { size?: string }
      defineProps<Props>()
    </script>`;
    const [c] = extractSfcComponent('C.vue', code, 'vue');
    expect(c?.propNames.toSorted()).toEqual(['size', 'tone']);
  });

  it('counts defineModel() as the prop it declares', () => {
    // v-model bindings are public props (modelValue by default, or the given name) and are exactly
    // what a Figma variant axis lines up against.
    const [c] = extractSfcComponent(
      'C.vue',
      `<script setup lang="ts">const m = defineModel<string>()\nconst t = defineModel<string>('title')</script>`,
      'vue',
    );
    expect(c?.propNames.toSorted()).toEqual(['modelValue', 'title']);
    expect(c?.propsExtracted).toBe(true);
  });

  it('resolves a type declared in one script block and used in another', () => {
    const code = `<script lang="ts">export interface Props { size?: string }</script>
      <script setup lang="ts">defineProps<Props>()</script>`;
    const [c] = extractSfcComponent('C.vue', code, 'vue');
    expect(c?.propNames).toEqual(['size']);
  });

  it.each([
    ['a type annotation', `interface Props { size?: string }\nlet props: Props = $props();`],
    ['a generic argument', `interface Props { size?: string }\nlet props = $props<Props>();`],
  ])('reads Svelte $props() declared with %s', (_label, body) => {
    const [c] = extractSfcComponent('C.svelte', `<script lang="ts">${body}</script>`, 'svelte');
    expect(c?.propNames).toEqual(['size']);
    expect(c?.propsExtracted).toBe(true);
  });

  it('marks SFC props NOT extracted when the prop type is imported', () => {
    const vue = `<script setup lang="ts">import type { Props } from './types'\ndefineProps<Props>()</script>`;
    const [v] = extractSfcComponent('C.vue', vue, 'vue');
    expect(v?.propsExtracted).toBe(false);
    expect(v?.propNames).toEqual([]);

    const svelte = `<script lang="ts">import type { Props } from './types'\nlet props: Props = $props();</script>`;
    const [s] = extractSfcComponent('C.svelte', svelte, 'svelte');
    expect(s?.propsExtracted).toBe(false);
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

  it('uses the alias of a signal input as the public prop name', () => {
    // The options object sits in a different argument slot per form — after the initial value for
    // input(), first for the required form — so the field name would otherwise leak as the prop.
    const code = `
      import { Component, input, model } from '@angular/core';
      @Component({ template: '' })
      export class FieldComponent {
        kind = input('primary', { alias: 'variant' });
        busy = input.required<boolean>({ alias: 'isBusy' });
        val = model('x', { alias: 'value' });
      }
    `;
    const [c] = extractAngularComponents('field.component.ts', code);
    expect(c?.propNames).toEqual(['variant', 'isBusy', 'value']);
  });

  it('reads inputs declared in the @Component metadata', () => {
    const code = `
      import { Component } from '@angular/core';
      @Component({ selector: 'app-b', template: '', inputs: ['size', 'kind: variant'] })
      export class ButtonComponent {}
    `;
    const [c] = extractAngularComponents('button.component.ts', code);
    // 'kind: variant' binds as `variant` in the template — that's the name a Figma axis matches.
    expect(c?.propNames).toEqual(['size', 'variant']);
    expect(c?.propsExtracted).toBe(true);
  });

  it('folds inputs inherited from a base class declared in the same file', () => {
    const code = `
      import { Component, Directive, Input } from '@angular/core';
      @Directive()
      export class BaseComponent { @Input() tone = 'a'; }
      @Component({ template: '' })
      export class ButtonComponent extends BaseComponent { @Input() size = 'md'; }
    `;
    const [c] = extractAngularComponents('button.component.ts', code);
    expect(c?.name).toBe('Button');
    expect(c?.propNames.toSorted()).toEqual(['size', 'tone']);
    expect(c?.propsExtracted).toBe(true);
  });

  it.each([
    [
      'an imported base',
      `import { BaseComponent } from './base';\n@Component({ template: '' })\nexport class ButtonComponent extends BaseComponent { @Input() size = 'md'; }`,
    ],
    // A namespaced or computed base hides inputs exactly as an imported one does.
    [
      'a namespaced base',
      `@Component({ template: '' })\nexport class ButtonComponent extends NS.BaseComponent { @Input() size = 'md'; }`,
    ],
    [
      'a mixin base',
      `@Component({ template: '' })\nexport class ButtonComponent extends mixin(Base) { @Input() size = 'md'; }`,
    ],
  ])('flags the input list incomplete, keeping its own, for %s', (_label, body) => {
    const [c] = extractAngularComponents(
      'button.component.ts',
      `import { Component, Input } from '@angular/core';\n${body}`,
    );
    expect(c?.name).toBe('Button');
    // The inherited inputs are unreadable, so the list isn't exhaustive…
    expect(c?.propsExtracted).toBe(false);
    // …but the class's own input is a read fact and must survive: the join reports it as a proven
    // match while claiming nothing about the axes it can't account for.
    expect(c?.propNames).toEqual(['size']);
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
