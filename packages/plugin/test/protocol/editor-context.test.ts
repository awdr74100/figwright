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
    expect(editorLimitation('figjam')).toContain('no components, variables or styles');
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
  it('names the editor alongside the error the API already raised', () => {
    const message = withEditorContext('Cannot write to document', 'dev');

    expect(message).toContain('Cannot write to document');
    expect(message).toContain('editor: dev');
    expect(message).toContain('blocks every write');
  });

  // The suffix is a statement about the environment, not a diagnosis of this failure — so it must
  // not overwrite or reword what actually went wrong.
  it('keeps the original message intact', () => {
    expect(withEditorContext('node 1:2 not found', 'figjam')).toMatch(/^node 1:2 not found /);
  });

  it('leaves Figma Design errors untouched', () => {
    expect(withEditorContext('boom', 'figma')).toBe('boom');
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
