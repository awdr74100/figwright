import { describe, expect, it } from 'vitest';

import {
  explainAnnotationError,
  parseAnnotations,
  restoreAnnotations,
  unknownCategories,
  writableAnnotation,
  writeAnnotations,
} from '../src/annotations.js';
import { annotatedNode } from './annotations-fake.js';

describe('writableAnnotation', () => {
  it('writes an annotation back by the side it was written with', () => {
    // Plain: its markdown is what its label makes.
    expect(writableAnnotation({ label: 'a_b', labelMarkdown: 'a\\_b' })).toEqual({ label: 'a_b' });
    // Markdown: anything else — a paragraph break, formatting.
    expect(writableAnnotation({ label: 'p1\n\n\np2', labelMarkdown: 'p1\n\np2' })).toEqual({
      labelMarkdown: 'p1\n\np2',
    });
    expect(writableAnnotation({ label: 'bold', labelMarkdown: '**bold**' })).toEqual({
      labelMarkdown: '**bold**',
    });
    // One side alone is that side; categoryId and properties ride along, as objects for Figma.
    expect(
      writableAnnotation({ labelMarkdown: '*x*', categoryId: '1:2', properties: ['fills'] }),
    ).toEqual({
      labelMarkdown: '*x*',
      categoryId: '1:2',
      properties: [{ type: 'fills' }],
    });
    expect(writableAnnotation({ properties: [{ type: 'width' }] } as Annotation)).toEqual({
      properties: [{ type: 'width' }],
    });
  });
});

describe('parseAnnotations', () => {
  it('takes the read shape', () => {
    expect(
      parseAnnotations(
        [{ label: 'a', labelMarkdown: 'a', categoryId: '1:1', properties: ['fills'] }],
        't',
      ),
    ).toEqual([{ label: 'a', labelMarkdown: 'a', categoryId: '1:1', properties: ['fills'] }]);
    expect(parseAnnotations([], 't')).toEqual([]);
  });

  it('refuses what is malformed, and a label of only spaces (stored as an empty annotation)', () => {
    expect(() => parseAnnotations({}, 't')).toThrow('t: annotations must be an array');
    expect(() => parseAnnotations([1], 't')).toThrow('t: annotations[0] must be an object');
    expect(() => parseAnnotations([{ label: 1 }], 't')).toThrow(
      't: annotations[0].label must be a string',
    );
    expect(() => parseAnnotations([{ properties: 'fills' }], 't')).toThrow(
      'properties must be an array of names',
    );
    expect(() => parseAnnotations([{ label: '   ' }], 't')).toThrow('only whitespace');
    // '' is Figma's to refuse, in its own words.
    expect(parseAnnotations([{ label: '' }], 't')).toEqual([{ label: '' }]);
  });
});

describe('unknownCategories', () => {
  const figmaCtx = {
    annotations: {
      getAnnotationCategoryByIdAsync: async (id: string) => (id === '1:1' ? { id } : null),
    },
  } as unknown as typeof figma;

  it('names the ids no category has, but passes one the node already carries', async () => {
    expect(
      await unknownCategories(
        figmaCtx,
        [
          { label: 'a', categoryId: '1:1' },
          { label: 'b', categoryId: '9:9' },
        ],
        [],
      ),
    ).toEqual(['9:9']);
    // A category deleted since the annotation was made: writing it back invents nothing.
    expect(
      await unknownCategories(figmaCtx, [{ label: 'a', categoryId: '9:9' }], [
        { label: 'a', categoryId: '9:9' },
      ] as Annotation[]),
    ).toEqual([]);
  });
});

describe('writeAnnotations', () => {
  it('writes, and says what Figma stored differently', () => {
    const node = annotatedNode();
    const notes = writeAnnotations(node, [{ label: '  padded  ' }, { labelMarkdown: '_it_' }], 't');
    expect(node.annotations).toEqual([
      { label: 'padded', labelMarkdown: 'padded' },
      { label: 'it', labelMarkdown: '*it*' },
    ]);
    expect(notes).toEqual([
      'annotations[0].label was stored as "padded" (Figma trims surrounding whitespace, stores line breaks as \\n and drops everything from a NUL character on)',
      'annotations[1].labelMarkdown was stored as "*it*" (Figma rewrites markdown into its own form)',
    ]);
  });

  it('writes back exactly what a read returned', () => {
    const node = annotatedNode();
    writeAnnotations(
      node,
      [{ label: 'a_b' }, { labelMarkdown: 'p1\n\np2' }, { properties: ['fills'] }],
      't',
    );
    // As get_annotations serializes them: properties as names, absent when there are none.
    const read = node.annotations.map(a => {
      const { properties, ...rest } = a;
      return properties === undefined ? rest : { ...rest, properties: properties.map(p => p.type) };
    });
    const before = JSON.stringify(node.annotations);
    expect(writeAnnotations(node, read, 't')).toEqual([]);
    expect(JSON.stringify(node.annotations)).toBe(before);
  });

  it('refuses a label and markdown that disagree, with the node as it was', () => {
    const node = annotatedNode();
    writeAnnotations(node, [{ label: 'kept' }], 't');
    expect(() =>
      writeAnnotations(node, [{ label: 'edited text', labelMarkdown: '**old** text' }], 't'),
    ).toThrow(
      /^t: annotations\[0\] gives a label and markdown that disagree — that markdown reads as "old text", not "edited text"/,
    );
    expect(node.annotations).toEqual([{ label: 'kept', labelMarkdown: 'kept' }]);
  });
});

describe('restoreAnnotations', () => {
  it('puts back a list whose markdown alone, or label alone, would not round-trip', () => {
    const node = annotatedNode();
    writeAnnotations(
      node,
      [{ label: 'p1\n\n\np2' }, { labelMarkdown: 'p1\n\np2' }, { label: 'x', categoryId: '1:1' }],
      't',
    );
    const snapshot = JSON.parse(JSON.stringify(node.annotations)) as Annotation[];
    writeAnnotations(node, [{ label: 'changed' }], 't');
    expect(restoreAnnotations(node, snapshot)).toBeUndefined();
    expect(node.annotations).toEqual(snapshot);
    expect(restoreAnnotations(node, snapshot)).toBeUndefined();
  });

  it('reports a list it could not put back exactly', () => {
    const node = annotatedNode();
    expect(
      restoreAnnotations(node, [
        { label: ' never stored as is ', labelMarkdown: ' never stored as is ' },
      ]),
    ).toMatch(/^annotations could not be put back exactly/);
  });
});

describe('explainAnnotationError', () => {
  it("says what Figma's property refusal actually checks, and leaves other errors as they are", () => {
    expect(
      explainAnnotationError(
        new Error('in set_annotations: Invalid property "strokes" for a FRAME node'),
        't',
      ).message,
    ).toMatch(
      /^in set_annotations: Invalid property "strokes" for a FRAME node \(t: Figma pins a property only where the node has it set — strokes on a node with a stroke/,
    );
    const other = new Error('in set_annotations: Duplicate property types are not allowed');
    expect(explainAnnotationError(other, 't')).toBe(other);
  });
});
