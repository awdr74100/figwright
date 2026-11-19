import { describe, expect, it } from 'vitest';

import { textStyleWriteScope } from '../../src/handlers/style-snapshot.js';

describe('textStyleWriteScope', () => {
  it('records only the labels a call writes, without bindings', () => {
    expect(textStyleWriteScope({ styleId: 'S', name: 'n' })).toEqual({
      fields: ['name'],
      withBindings: false,
    });
    expect(
      textStyleWriteScope({ styleId: 'S', name: 'n', description: 'd', documentationLinks: [] }),
    ).toEqual({ fields: ['documentationLinks', 'name', 'description'], withBindings: false });
  });

  // A literal written to a bound field takes the binding off, so the bindings go in the record.
  it('records the literals a call writes, with the bindings', () => {
    expect(
      textStyleWriteScope({
        styleId: 'S',
        fontSize: 12,
        lineHeight: { unit: 'AUTO' },
        letterSpacing: { unit: 'PIXELS', value: 0 },
        textWrapStyle: 'BALANCE',
      }),
    ).toEqual({
      fields: ['fontSize', 'lineHeight', 'letterSpacing', 'textWrapStyle'],
      withBindings: true,
    });
  });

  it('records everything when a call changes the font or applies bindings', () => {
    expect(textStyleWriteScope({ styleId: 'S', fontName: { family: 'Inter' } })).toEqual({
      withBindings: true,
    });
    expect(textStyleWriteScope({ styleId: 'S', name: 'n', boundVariables: {} })).toEqual({
      withBindings: true,
    });
  });

  it('records nothing for a call that writes nothing, and ignores values of the wrong type', () => {
    expect(textStyleWriteScope({ styleId: 'S' })).toEqual({ fields: [], withBindings: false });
    expect(textStyleWriteScope(undefined)).toEqual({ fields: [], withBindings: false });
    expect(textStyleWriteScope({ styleId: 'S', name: 1, fontSize: '12' })).toEqual({
      fields: [],
      withBindings: false,
    });
  });
});
