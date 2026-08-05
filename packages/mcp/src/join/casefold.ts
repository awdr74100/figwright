// The one casefold every join uses to compare a Figma-authored name against a code-authored one.
// Shared rather than copied per join because all three (component / icon / token) compare the same
// two worlds, and a rule that drifts between them produces inconsistent matches for the same repo.
//
// Three things get normalized away, each because the two sides genuinely disagree on it:
//
//  1. Separators and case — Figma labels are prose ("Show icon", "Full width"), code identifiers
//     are `showIcon` / `full-width`. Without this only single-word names ever match.
//  2. Latin diacritics — a designer writes "Café", the identifier is `Cafe`, because a JS/TS symbol
//     is ASCII by convention even when the product name isn't. Decompose, drop the combining marks,
//     then recompose: recomposing matters because NFD also splits Hangul syllables into jamo, and
//     leaving them split would change every Korean name's bigrams.
//  3. Nothing else. Letters and digits are kept in EVERY script.
//
// That last point is load-bearing. An `[a-z0-9]` filter doesn't merely fail to match a CJK name —
// it folds every one of them to the empty string, and equal empty strings compare as a *perfect*
// match. A Chinese "按鈕" then scores 1.0 against a Japanese "ボタン", and any map keyed on the fold
// collapses every non-Latin entry onto one bucket.

/** Casefold a name for cross-side comparison. See the notes above before changing this. */
export const casefold = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // combining diacritical marks
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
