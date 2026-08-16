import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// A raw NUL byte in a source file makes git classify it as binary: the diff renders as
// "Binary files differ", GitHub shows "Binary file not shown", and `git log -p` / `git blame` on it
// are dead. `grep` declines to print matches too.
//
// This has now happened twice in this repo, both times from writing a dedup separator as a literal
// character instead of the `U+0000` escape every module means to use — once in token-index.ts, then
// again in a file added while fixing the first. Nothing else catches it: the runtime string is
// identical, so typecheck, lint and the tests all pass. Hence a test.
const ROOTS = [join(import.meta.dirname, '..', 'src'), join(import.meta.dirname, '..', 'test')];

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  });

describe('source files stay textual', () => {
  it('no .ts file contains a raw control byte git would read as binary', () => {
    const offenders = ROOTS.flatMap(sourceFiles)
      .filter(path => {
        const buf = readFileSync(path);
        // NUL is what git actually keys on. Tab (9), newline (10) and carriage return (13) are
        // ordinary source bytes; everything else below 32 would be just as invisible in review.
        return buf.some(b => b < 32 && b !== 9 && b !== 10 && b !== 13);
      })
      .map(path => path.slice(path.indexOf('packages/')));

    // If this fails: write the byte as an escape (`U+0000`) rather than embedding it. The runtime
    // string is identical and the file stays reviewable.
    expect(offenders).toEqual([]);
  });
});
