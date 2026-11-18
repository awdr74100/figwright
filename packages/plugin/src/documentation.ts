import type { DocumentationLinkInfo } from '@figwright/shared';

/**
 * A component's or component set's documentation, as Figma keeps it: a description held twice — as
 * plain text and as markdown — plus at most one documentation link.
 *
 * The two descriptions are not independent fields. Each write replaces both: setting `description`
 * makes the markdown the escaped plain text (so it wipes any bold, link or list), and setting
 * `descriptionMarkdown` makes `description` that markdown with its syntax stripped. Neither
 * direction round-trips in general (measured 2026-11-19 against Figma Design):
 *
 * - Plain → markdown escapes `\ * _ \` ~`and nothing else, so plain text such as`[x](y)`, `1. a`, `-
 *   a`or`# a` reads back from its own markdown as a link, a list or a heading;
 * - Markdown → plain drops every marker, and writes paragraph breaks as three newlines.
 *
 * Which is why restoring a description has to try both, and check what landed (writeDescription).
 */

/** The fields every documented node (a COMPONENT or COMPONENT_SET) carries. */
export interface DocumentedNode {
  description: string;
  descriptionMarkdown: string;
  documentationLinks: ReadonlyArray<DocumentationLink>;
}

/** Everything a write can change, as it was before. */
export interface DocumentationSnapshot {
  description: string;
  descriptionMarkdown: string;
  documentationLinks: DocumentationLinkInfo[];
}

/**
 * The markdown Figma stores when `description` is set to `plain`: `\ * _ \` ~` backslash-escaped,
 * runs of spaces and tabs collapsed to one space, a space on either side of a line break dropped.
 *
 * A model of Figma's own conversion, not a call into it, measured to match it on 2,245 strings
 * (2026-11-19: every printable ASCII character in four positions; 1,307 random strings over an
 * alphabet of the escaped characters, markdown syntax, whitespace, CJK and emoji, two seeds; and 50
 * Unicode specials — every Unicode space, zero-width and direction marks, line / paragraph
 * separators, fullwidth `＊ ＿ ～ ＼`, combining marks, ZWJ emoji — in ten positions each). It is only
 * ever used to ask "would plain text reproduce this markdown?", and a mismatch errs on the safe
 * side: the markdown is reported (or kept) when it did not need to be, never dropped when it did.
 */
export const plainToMarkdown = (plain: string): string =>
  plain
    .replace(/[\\*_`~]/g, '\\$&')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n');

/**
 * Whether the markdown says something the plain text does not — formatting, a link, paragraph
 * structure — i.e. whether writing `description` alone would lose it.
 */
export const hasFormatting = (node: Pick<DocumentedNode, 'description' | 'descriptionMarkdown'>) =>
  node.descriptionMarkdown !== plainToMarkdown(node.description);

const copyLinks = (links: ReadonlyArray<DocumentationLink>): DocumentationLinkInfo[] =>
  links.map(link => ({ uri: link.uri }));

/**
 * The documentation fields a read adds beside `description`: the markdown only when plain text
 * would not reproduce it, the links only when there are any. A component with a plain description
 * and no link reads exactly as it did before these fields existed.
 */
export const readDocumentationExtras = (
  node: DocumentedNode,
): { descriptionMarkdown?: string; documentationLinks?: DocumentationLinkInfo[] } => {
  const out: { descriptionMarkdown?: string; documentationLinks?: DocumentationLinkInfo[] } = {};
  // Checked rather than assumed: a read must never fail where it used to succeed, and a runtime
  // without one of these fields (an older Figma desktop) should read as it did before they existed.
  const { description, descriptionMarkdown, documentationLinks } = node as Partial<DocumentedNode>;
  if (
    typeof description === 'string' &&
    typeof descriptionMarkdown === 'string' &&
    descriptionMarkdown !== plainToMarkdown(description)
  ) {
    out.descriptionMarkdown = descriptionMarkdown;
  }
  if (Array.isArray(documentationLinks) && documentationLinks.length > 0) {
    out.documentationLinks = copyLinks(documentationLinks);
  }
  return out;
};

export const snapshotDocumentation = (node: DocumentedNode): DocumentationSnapshot => ({
  description: node.description,
  descriptionMarkdown: node.descriptionMarkdown,
  documentationLinks: copyLinks(node.documentationLinks),
});

const sameLinks = (
  a: ReadonlyArray<DocumentationLink>,
  b: ReadonlyArray<DocumentationLink>,
): boolean => a.length === b.length && a.every((link, i) => link.uri === b[i]?.uri);

/** What a description write asks for; at least one side is present. */
export interface DescriptionRequest {
  description?: string;
  markdown?: string;
}

/**
 * Write a description. One side alone is written as given. Both sides are written so that each ends
 * up as asked: the plain text first, and the markdown only when the plain text did not already
 * produce it — after which the plain text must still read the same, or the two disagree.
 *
 * Returns false when they disagree (the node is left with the markdown written; the caller restores
 * it). Both sides as Figma itself reported them — a snapshot, a get_local_components entry — always
 * agree: that is the case batch rollback depends on, measured exact on every description tried.
 */
export const writeDescription = (node: DocumentedNode, request: DescriptionRequest): boolean => {
  if (request.markdown === undefined) {
    node.description = request.description ?? '';
    return true;
  }
  if (request.description === undefined) {
    node.descriptionMarkdown = request.markdown;
    return true;
  }
  node.description = request.description;
  if (node.descriptionMarkdown === request.markdown) return true;
  const plain = node.description;
  node.descriptionMarkdown = request.markdown;
  return node.description === plain;
};

/**
 * Put a node's documentation back as a snapshot recorded it, writing only what differs. Resolves to
 * a note when what is there afterwards still differs — the caller reports it rather than claiming a
 * clean restore.
 */
export const restoreDocumentation = (
  node: DocumentedNode,
  was: DocumentationSnapshot,
): string | undefined => {
  if (!sameLinks(node.documentationLinks, was.documentationLinks)) {
    node.documentationLinks = was.documentationLinks.map(link => ({ uri: link.uri }));
  }
  if (
    node.description !== was.description ||
    node.descriptionMarkdown !== was.descriptionMarkdown
  ) {
    writeDescription(node, { description: was.description, markdown: was.descriptionMarkdown });
  }
  const off: string[] = [];
  if (node.description !== was.description) off.push('description');
  if (node.descriptionMarkdown !== was.descriptionMarkdown) off.push('descriptionMarkdown');
  if (!sameLinks(node.documentationLinks, was.documentationLinks)) off.push('documentationLinks');
  return off.length === 0 ? undefined : `${off.join(', ')} could not be put back exactly`;
};

/** A string for a message: quoted, and cut short past `max` characters. */
export const quoteForMessage = (text: string, max = 80): string =>
  JSON.stringify(text.length > max ? `${text.slice(0, max)}…` : text);
