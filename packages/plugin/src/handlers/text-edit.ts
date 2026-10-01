import { SEGMENT_FIELDS } from './batch-snapshot.js';

/**
 * Edit a TEXT node's characters without touching the styling of what is not edited.
 *
 * Assigning `characters` restyles the whole node: every run takes the first character's style, so a
 * bold word, a coloured span or a link anywhere in the node is gone (measured: replacing one word
 * wiped a bold red run elsewhere in the same node). `insertCharacters` / `deleteCharacters` leave
 * existing characters as they are, which is the whole reason to go through them. Both still need
 * the node's fonts loaded, as `characters` does.
 */

/**
 * Replace `[start, end)` with `replacement`, leaving every other character's style alone.
 *
 * Replacement text takes the style of the first character it replaces — what typing over a
 * selection does in the editor. A pure insertion takes the style of the character before it, as a
 * caret does.
 */
export const replaceRange = (
  text: TextNode,
  start: number,
  end: number,
  replacement: string,
): void => {
  if (replacement.length > 0) {
    text.insertCharacters(start, replacement, start < end ? 'AFTER' : 'BEFORE');
  }
  if (end > start) {
    text.deleteCharacters(start + replacement.length, end + replacement.length);
  }
};

/** The longest prefix and suffix two strings share, without overlapping in either. */
const sharedEdges = (a: string, b: string): { prefix: number; suffix: number } => {
  const limit = Math.min(a.length, b.length);
  let prefix = 0;
  while (prefix < limit && a.charCodeAt(prefix) === b.charCodeAt(prefix)) prefix += 1;
  let suffix = 0;
  while (
    suffix < limit - prefix &&
    a.charCodeAt(a.length - 1 - suffix) === b.charCodeAt(b.length - 1 - suffix)
  ) {
    suffix += 1;
  }
  return { prefix, suffix };
};

/**
 * What set_text may keep of a node's text: the shared prefix and suffix, each shrunk to whole style
 * runs.
 *
 * Shared characters alone are not enough. "Hello World" with a bold "World" rewritten as "Changed"
 * shares only the final "d", and keeping it would leave one bold letter at the end of an otherwise
 * plain word — worse than assigning `characters`, which at least restyles the node evenly. So an
 * edge that cuts into a run backs off to the run's boundary: what survives is always a run kept
 * whole, and when nothing does, the edit is the same whole-node rewrite assignment makes. Backing
 * off to a run boundary also keeps an edge from landing between the halves of a surrogate pair,
 * since a run starts on a whole character.
 */
export const keptEdges = (text: TextNode, next: string): { prefix: number; suffix: number } => {
  const before = text.characters;
  const { prefix, suffix } = sharedEdges(before, next);
  const starts = text.getStyledTextSegments([...SEGMENT_FIELDS]).map(run => run.start);
  const bounds = [...starts, before.length];
  const keptPrefix = Math.max(0, ...bounds.filter(b => b <= prefix));
  const suffixStart = before.length - suffix;
  const keptSuffixStart = Math.min(before.length, ...bounds.filter(b => b >= suffixStart));
  return { prefix: keptPrefix, suffix: before.length - keptSuffixStart };
};
