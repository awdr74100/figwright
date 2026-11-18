import { describe, expect, it } from 'vitest';

import {
  plainToMarkdown,
  readDocumentationExtras,
  restoreDocumentation,
  snapshotDocumentation,
  writeDescription,
} from '../src/documentation.js';
import { fakeDocumented } from './documentation-fake.js';

describe('plainToMarkdown', () => {
  // Pairs read back from Figma (2026-11-19): `description = plain` → `descriptionMarkdown`.
  it.each([
    ['a*b', 'a\\*b'],
    ['_a_', '\\_a\\_'],
    ['`a`', '\\`a\\`'],
    ['~~a~~', '\\~\\~a\\~\\~'],
    ['a\\b', 'a\\\\b'],
    ['a  b', 'a b'],
    ['a\tb', 'a b'],
    ['a  \nb', 'a\nb'],
    ['a\n  b', 'a\nb'],
    ['a \n b', 'a\nb'],
    ['a\n\n\nb', 'a\n\n\nb'],
    // Not escaped — which is why markdown written back from plain text can turn it into syntax.
    ['[x](y)', '[x](y)'],
    ['1. a', '1. a'],
    ['- a', '- a'],
    ['# a', '# a'],
    ['<b>html</b>', '<b>html</b>'],
    [
      'kbq-arrow_16\n\ndownload, вниз\n\npt-icons_16',
      'kbq-arrow\\_16\n\ndownload, вниз\n\npt-icons\\_16',
    ],
  ])('%j → %j', (plain, markdown) => {
    expect(plainToMarkdown(plain)).toBe(markdown);
  });
});

describe('readDocumentationExtras', () => {
  it('adds nothing for a plain description without a link', () => {
    expect(readDocumentationExtras(fakeDocumented({ description: 'a_b *c*' }))).toEqual({});
    expect(readDocumentationExtras(fakeDocumented())).toEqual({});
  });

  it('carries the markdown when plain text would lose it, and the link when there is one', () => {
    const node = fakeDocumented({
      descriptionMarkdown: '**bold** [l](https://a.com)',
      documentationLinks: [{ uri: 'https://storybook.example.com' }],
    });
    expect(readDocumentationExtras(node)).toEqual({
      descriptionMarkdown: '**bold** [l](https://a.com)',
      documentationLinks: [{ uri: 'https://storybook.example.com' }],
    });
  });

  it('carries paragraph breaks, which the plain text spells differently', () => {
    const node = fakeDocumented({ descriptionMarkdown: 'a\n\nb' });
    expect(node.description).toBe('a\n\n\nb');
    expect(readDocumentationExtras(node)).toEqual({ descriptionMarkdown: 'a\n\nb' });
  });

  // A read must not start failing where it used to succeed.
  it('reads a node without the markdown or link fields as before', () => {
    const old = { description: 'x' } as unknown as Parameters<typeof readDocumentationExtras>[0];
    expect(readDocumentationExtras(old)).toEqual({});
  });
});

describe('writeDescription', () => {
  it('writes one side as given', () => {
    const node = fakeDocumented({ descriptionMarkdown: '**b**' });
    expect(writeDescription(node, { description: 'plain' })).toBe(true);
    expect(node.descriptionMarkdown).toBe('plain');
    expect(writeDescription(node, { markdown: '**b**' })).toBe(true);
    expect(node.description).toBe('b');
  });

  it('accepts both sides when they agree, whichever form carries the text', () => {
    const formatted = fakeDocumented();
    expect(
      writeDescription(formatted, {
        description: 'bold l',
        markdown: '**bold** [l](https://a.com)',
      }),
    ).toBe(true);
    expect(formatted.descriptionMarkdown).toBe('**bold** [l](https://a.com)');

    // Plain text that its own markdown would turn into a link: only the plain write reproduces it.
    const literal = fakeDocumented();
    expect(writeDescription(literal, { description: '[x](y)', markdown: '[x](y)' })).toBe(true);
    expect(literal.description).toBe('[x](y)');
  });

  it('reports a disagreement instead of picking a side', () => {
    const node = fakeDocumented();
    expect(writeDescription(node, { description: 'new text', markdown: '**old** text' })).toBe(
      false,
    );
  });
});

describe('restoreDocumentation', () => {
  it.each([
    ['formatted', { descriptionMarkdown: '**bold** and *it* [l](https://a.com)\n\n- a\n- b' }],
    ['plain text that reads as markdown', { description: '[x](y) 1. a' }],
    ['plain with underscores', { description: 'kbq-arrow_16\n\npt-icons_16' }],
    ['paragraphs', { descriptionMarkdown: 'p1\n\np2' }],
    ['empty', {}],
  ])('puts back a %s description exactly', (_, init) => {
    const node = fakeDocumented({ ...init, documentationLinks: [{ uri: 'https://a.com' }] });
    const was = snapshotDocumentation(node);
    node.description = 'something else **x**';
    node.documentationLinks = [];
    expect(restoreDocumentation(node, was)).toBeUndefined();
    expect(snapshotDocumentation(node)).toEqual(was);
  });

  it('names what it could not put back', () => {
    const node = fakeDocumented({ description: 'a' });
    const was = {
      description: 'not reachable',
      descriptionMarkdown: 'neither',
      documentationLinks: [],
    };
    // The markdown lands (it is written last); the plain text it implies is not the recorded one.
    expect(restoreDocumentation(node, was)).toBe('description could not be put back exactly');
  });
});
