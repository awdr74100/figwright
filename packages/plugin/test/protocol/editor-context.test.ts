import { describe, expect, it } from 'vitest';

import {
  editorLimitation,
  isEmbeddedInPanel,
  withEditorContext,
} from '../../protocol/editor-context.js';

describe('editorLimitation', () => {
  // The manifest claims three editors; two of them can't do what the tool surface assumes.
  it('describes what Dev Mode and FigJam refuse', () => {
    expect(editorLimitation('dev')).toContain('blocks every write');
    expect(editorLimitation('figjam')).toContain(
      'no components, variables, styles or Figma Motion',
    );
  });

  // Verified live in FigJam: createFrame / createSection / createRectangle / createText all
  // succeed. An earlier wording claimed FigJam had no frames, which would have sent an agent
  // looking for a workaround it never needed.
  it('does not claim FigJam lacks what it actually has', () => {
    const figjam = editorLimitation('figjam') ?? '';

    expect(figjam).not.toContain('no frames');
    expect(figjam).toContain('frames, sections, shapes and text all work');
  });

  // Verified live in Dev Mode: createFrame, createPage, createVariableCollection and
  // createPaintStyle are all rejected, so a wording that only mentions nodes would understate the
  // ban and leave an agent thinking variables or styles were still writable.
  it('states the ban over every kind of write, not just nodes', () => {
    const dev = editorLimitation('dev') ?? '';

    expect(dev).toContain('nodes, pages, variables and styles');
    expect(dev).toContain('Design mode');
  });

  // Figma Design is the case the whole toolset was written for, so there is nothing to warn about
  // — and returning a string here would put a caveat on every error the common case ever sees.
  it('has nothing to say about Figma Design', () => {
    expect(editorLimitation('figma')).toBeNull();
  });

  // `slides` and `buzz` exist in the plugin typings but not in our manifest, so the plugin can't be
  // running there. Anything unrecognised is treated as unremarkable rather than guessed at.
  it('stays silent for editors the manifest never opts into', () => {
    expect(editorLimitation('slides')).toBeNull();
    expect(editorLimitation('buzz')).toBeNull();
    expect(editorLimitation('')).toBeNull();
  });
});

describe('withEditorContext', () => {
  const read = false;
  const write = true;

  // Each message below is what the editor itself raised, measured live with every tool called on
  // arguments Figma Design accepts.
  it.each([
    ['dev', 'in createFrame: Can\'t call "createFrame" in read-only mode'],
    ['dev', 'in set_name: Can\'t set "name" in read-only mode'],
    ['figjam', "cannot read property 'createVariableCollection' of undefined"],
    ['figjam', 'not a function'],
    ['figjam', "create_frame: fills — cannot read property 'getVariableByIdAsync' of undefined"],
    // The V8 wording of the same failure.
    ['figjam', "Cannot read properties of undefined (reading 'getLocalVariableCollectionsAsync')"],
    // A handler meeting what FigJam lacks, in its own words.
    ['figjam', 'swap_component: node 0:0 is not an INSTANCE'],
    ['figjam', 'add_component_property: 0:0 (DOCUMENT) is not a component or component set'],
    ['figjam', 'combine_as_variants: node 0:0 is a DOCUMENT, not a COMPONENT'],
    ['figjam', 'get_motion_styles: the Figma Motion API is not available here.'],
  ])('names %s when it is behind the error: %s', (editorType, raised) => {
    const message = withEditorContext(new Error(raised), editorType, read);
    expect(message.startsWith(`${raised} (editor: ${editorType} — `)).toBe(true);
    expect(message).toContain(editorLimitation(editorType)!);
  });

  // Dev Mode refuses every write, so a write refused first for its own arguments would only be
  // refused again once fixed.
  it('names Dev Mode on any error a write raises there', () => {
    expect(
      withEditorContext(new Error('rename_node: node 9:999 not found'), 'dev', write),
    ).toContain('(editor: dev — Dev Mode blocks every write');
  });

  // Measured: set_layout_props reworded the read-only refusal it caught ("… HUG needs an auto-layout
  // frame …"), and the refusal survived only as the error it wrapped.
  it('finds the refusal in an error a handler wrapped', () => {
    const wrapped = new Error('set_layout_props: cannot set layoutSizingHorizontal=FILL', {
      cause: new Error(
        'in set_layoutSizingHorizontal: Can\'t set "layoutSizingHorizontal" in read-only mode',
      ),
    });
    expect(withEditorContext(wrapped, 'dev', read)).toBe(
      `set_layout_props: cannot set layoutSizingHorizontal=FILL (editor: dev — ${editorLimitation('dev')!})`,
    );
  });

  // The suffix used to go on every error in these editors, telling an agent whose own arguments
  // were refused that the editor was to blame.
  it.each([
    ['dev', 'get_node: node 9:999 not found', read],
    ['figjam', 'create_rectangle: width must be a number, 0 or more', write],
    ['figjam', 'set_text: node 9:999 not found', write],
    ['figjam', 'set_reactions: node 0:1 not found or cannot have reactions', write],
    ['figjam', 'resize_nodes: width and height must be finite numbers', write],
  ])('leaves a %s error the editor is not behind untouched: %s', (editorType, raised, writes) => {
    expect(withEditorContext(new Error(raised), editorType, writes)).toBe(raised);
  });

  it('leaves Figma Design errors untouched, refusal-shaped or not', () => {
    expect(withEditorContext(new Error('boom'), 'figma', write)).toBe('boom');
    expect(withEditorContext(new Error('not a function'), 'figma', read)).toBe('not a function');
  });

  it('takes a thrown non-Error as its message', () => {
    expect(withEditorContext('not a function', 'figjam', read)).toContain('(editor: figjam — ');
  });
});

describe('isEmbeddedInPanel', () => {
  // Keyed off `figma.mode`, not editorType: what decides whether the panel's own window chrome has
  // anything to act on is how the plugin was launched, not what the document allows.
  it('is true only in Dev Mode’s Inspect panel', () => {
    expect(isEmbeddedInPanel('inspect')).toBe(true);
    expect(isEmbeddedInPanel('default')).toBe(false);
    expect(isEmbeddedInPanel('textreview')).toBe(false);
  });

  // Reaching codegen mode needs a `codegen` capability this manifest doesn't declare, so treating
  // it as embedded would be speculation about a state the plugin can't be in.
  it('does not claim codegen, a mode this manifest cannot reach', () => {
    expect(isEmbeddedInPanel('codegen')).toBe(false);
  });
});
