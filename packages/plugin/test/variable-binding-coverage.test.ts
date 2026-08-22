import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

// The drift ratchet for variable bindings.
//
// Figma does not keep a paint's / effect's / grid's variable binding in the owning node's
// `boundVariables` — it keeps it on the object itself, and the serializer has to read each one
// individually. Missing one is invisible: the payload still carries a perfectly good literal
// colour, it has just quietly stopped saying that the colour is a token (issue #164, where a shadow
// bound to a variable came back as a plain RGBA).
//
// `plugin-api.d.ts` names every bindable surface with a `VariableBindable*Field` alias, so that list
// is the authoritative inventory. Recording it here turns "Figma made a new kind of object
// bindable" from something nobody notices into a CI failure on the typings bump — the one moment
// someone is actually looking. Fields *inside* an existing family need no entry: the serializer
// passes field names through as Figma reports them, so a new one rides along on its own.

const resolveFrom = createRequire(import.meta.url);

/** Where the sandbox's own bindings are read. Kept next to the inventory it has to keep up with. */
const HANDLED: Record<string, string> = {
  Node: "serializer.ts collectBoundVariables — a node's own boundVariables",
  Text: 'serializer.ts collectBoundVariables (TEXT nodes) + get-styles.ts for a TextStyle',
  Paint: 'serializer.ts serializePaint, SOLID branch',
  ColorStop: 'serializer.ts serializePaint, gradient-stop branch',
  Effect: 'serializer.ts serializeEffect, both branches',
  LayoutGrid: 'serializer.ts serializeLayoutGrid, both branches',
  ComponentProperty: 'serializer.ts collectComponentProperties reports the value, not its binding',
  ComponentPropertyDefinition:
    'not serialized — get_component_api reports definitions, not bindings',
  // The three style-level families are a flat `VariableAlias[]` of whatever is bound somewhere in
  // the style's array: they name neither which paint/effect nor which field. Measured against a
  // live file, every id in them also appears on the individual object, so reading them would only
  // add a lossier copy of what get_styles already returns exactly.
  PaintStyle: 'deliberately not read — lossy summary of the per-paint bindings (see get-styles.ts)',
  EffectStyle: 'deliberately not read — lossy summary of the per-effect bindings',
  GridStyle: 'deliberately not read — lossy summary of the per-grid bindings',
};

describe('variable-binding coverage vs @figma/plugin-typings', () => {
  const pkg = dirname(resolveFrom.resolve('@figma/plugin-typings/package.json'));
  const dts = join(pkg, 'plugin-api.d.ts');

  it('finds the typings it audits', () => {
    // A silently absent .d.ts would make every assertion below vacuous.
    expect(existsSync(dts)).toBe(true);
  });

  it('accounts for every bindable surface the typings declare', () => {
    const source = readFileSync(dts, 'utf8');
    const families = [...source.matchAll(/^type VariableBindable(\w+)Field =/gm)].map(m => m[1]!);
    expect(families.length).toBeGreaterThan(5);

    const unhandled = families.filter(f => !Object.hasOwn(HANDLED, f));
    const stale = Object.keys(HANDLED).filter(f => !families.includes(f));
    // Guidance rides inside the compared value so CI prints it — oxlint's valid-expect forbids
    // expect()'s message argument.
    expect({ unhandled, stale }).toEqual({
      unhandled: [],
      stale: [],
      ...(unhandled.length > 0
        ? {
            hint:
              `Figma made a new kind of object variable-bindable (${unhandled.join(', ')}). ` +
              'Decide where its binding is read — the object that owns it, the way serializePaint / ' +
              'serializeEffect / serializeLayoutGrid do — then record it in HANDLED. Leaving it ' +
              'unread reproduces issue #164: a bound value comes back as a plain literal.',
          }
        : {}),
      ...(stale.length > 0
        ? { hint: `Removed from the typings: ${stale.join(', ')} — drop it from HANDLED.` }
        : {}),
    });
  });
});
