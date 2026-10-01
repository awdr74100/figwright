/**
 * A TEXT node that keeps a style per character, the way Figma's does, for the set_text and
 * find_replace_text tests. What a plain `characters` string cannot show, and these tests are
 * about:
 *
 * - Assigning `characters` restyles the whole node with its first character's style (measured);
 * - `insertCharacters` / `deleteCharacters` leave every other character's style alone, and inserted
 *   text copies its style from the character before it ('BEFORE', the default) or after it;
 * - All three refuse to run before the node's fonts are loaded, as Figma does.
 */

export interface FakeText {
  id: string;
  type: 'TEXT';
  characters: string;
  fontName: { family: string; style: string };
  insertCharacters(start: number, characters: string, useStyle?: 'BEFORE' | 'AFTER'): void;
  deleteCharacters(start: number, end: number): void;
  getStyledTextSegments(
    fields: readonly string[],
  ): { start: number; end: number; characters: string }[];
  /** Consecutive characters sharing a style, as [text, style] pairs. */
  runs(): [string, string][];
}

/**
 * `runs` lays out the starting text, e.g. [['Hello ', 'regular'], ['bold', 'bold-red']]. Pass the
 * `loaded` flag of the fake figma, so an edit before `loadFontAsync` throws.
 */
export const makeText = (
  id: string,
  runs: [string, string][],
  fonts: { loaded: boolean },
): FakeText => {
  let chars: string[] = [];
  let styles: string[] = [];
  for (const [text, style] of runs) {
    for (const ch of text.split('')) {
      chars.push(ch);
      styles.push(style);
    }
  }
  const requireFonts = (): void => {
    if (!fonts.loaded) throw new Error('Cannot write to node with unloaded font');
  };
  const node: FakeText = {
    id,
    type: 'TEXT',
    fontName: { family: 'Inter', style: 'Regular' },
    get characters() {
      return chars.join('');
    },
    set characters(value: string) {
      requireFonts();
      const first = styles[0] ?? 'default';
      chars = value.split('');
      styles = chars.map(() => first);
    },
    insertCharacters(start, inserted, useStyle = 'BEFORE') {
      requireFonts();
      const from = useStyle === 'BEFORE' ? start - 1 : start;
      const style = styles[from] ?? styles[start] ?? styles[start - 1] ?? 'default';
      chars.splice(start, 0, ...inserted.split(''));
      styles.splice(start, 0, ...inserted.split('').map(() => style));
    },
    deleteCharacters(start, end) {
      requireFonts();
      chars.splice(start, end - start);
      styles.splice(start, end - start);
    },
    getStyledTextSegments() {
      return node
        .runs()
        .reduce<{ start: number; end: number; characters: string }[]>((out, [text]) => {
          const start = out.at(-1)?.end ?? 0;
          out.push({ start, end: start + text.length, characters: text });
          return out;
        }, []);
    },
    runs() {
      const out: [string, string][] = [];
      chars.forEach((ch, i) => {
        const last = out.at(-1);
        if (last !== undefined && last[1] === styles[i]) last[0] += ch;
        else out.push([ch, styles[i]!]);
      });
      return out;
    },
  };
  return node;
};
