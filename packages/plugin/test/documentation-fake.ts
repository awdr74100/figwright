import { plainToMarkdown } from '../src/documentation.js';

/**
 * A COMPONENT / COMPONENT_SET whose documentation fields behave as Figma's were measured to
 * (2026-11-19, Figma Design):
 *
 * - `description =` trims surrounding whitespace, stores `\r\n` / `\r` as `\n`, drops everything from
 *   a NUL on, and makes the markdown the escaped plain text — wiping any formatting;
 * - `descriptionMarkdown =` rewrites `_x_` as `*x*` and drops a hard break's trailing spaces, and
 *   makes the plain text the markdown with its syntax stripped (paragraph breaks as three
 *   newlines);
 * - `documentationLinks =` refuses more than one link and a uri without a scheme.
 *
 * The markdown → plain direction is a small model covering the syntax the tests use (bold, italic,
 * links, list markers, headings, paragraphs), not a markdown parser.
 */
export interface FakeDocumented {
  id: string;
  type: 'COMPONENT' | 'COMPONENT_SET';
  name: string;
  remote: boolean;
  parent: unknown;
  description: string;
  descriptionMarkdown: string;
  documentationLinks: { uri: string }[];
}

const normalisePlain = (text: string): string => {
  const nul = text.indexOf('\0');
  const cut = nul === -1 ? text : text.slice(0, nul);
  return cut.replace(/\r\n?/g, '\n').trim();
};

const normaliseMarkdown = (markdown: string): string =>
  markdown.replace(/(?<![\\*])_([^_]+)_/g, '*$1*').replace(/ {2,}\n/g, '\n');

const markdownToPlain = (markdown: string): string =>
  markdown
    .split(/\n{2,}/)
    .map(block =>
      block
        .replace(/^#{1,6} /gm, '')
        .replace(/^(?:[-*+]|\d+\.) /gm, '')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')
        .replace(/\\([\\*_`~])/g, '$1'),
    )
    .join('\n\n\n');

export const fakeDocumented = (
  init: Partial<Omit<FakeDocumented, 'description' | 'descriptionMarkdown'>> & {
    description?: string;
    descriptionMarkdown?: string;
  } = {},
): FakeDocumented => {
  let plain = '';
  let markdown = '';
  let links: { uri: string }[] = init.documentationLinks ?? [];
  const node = {
    id: init.id ?? 'C:1',
    type: init.type ?? 'COMPONENT',
    name: init.name ?? 'Button',
    remote: init.remote ?? false,
    parent: init.parent ?? null,
    get description() {
      return plain;
    },
    set description(value: string) {
      plain = normalisePlain(value);
      markdown = plainToMarkdown(plain);
    },
    get descriptionMarkdown() {
      return markdown;
    },
    set descriptionMarkdown(value: string) {
      markdown = normaliseMarkdown(value.trim());
      plain = markdownToPlain(markdown);
    },
    get documentationLinks() {
      return links;
    },
    set documentationLinks(value: { uri: string }[]) {
      if (value.length > 1) {
        throw new Error(
          'in set_documentationLinks: Documentation links API takes a list of size 0 or 1',
        );
      }
      if (value.some(link => !/^[a-z][a-z0-9+.-]*:/i.test(link.uri))) {
        throw new Error('in set_documentationLinks: Documentation link must be a URL');
      }
      links = value.map(link => ({ uri: link.uri }));
    },
  };
  if (init.descriptionMarkdown !== undefined) node.descriptionMarkdown = init.descriptionMarkdown;
  else if (init.description !== undefined) node.description = init.description;
  return node;
};
