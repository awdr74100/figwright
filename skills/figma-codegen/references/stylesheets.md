# Class names in a nesting stylesheet

Loaded by **figma-codegen**, and only when you are writing a stylesheet in a language whose `&`
_concatenates_ — SCSS, Sass, Less, Stylus, or plain CSS run through postcss-nested. (Tailwind and
CSS-in-JS declare no class names of their own, and _native_ CSS nesting can't concatenate at all:
there `&` is an element reference, so `&__title` is simply invalid.)

**Declare every class name in full, at the top level.** A name assembled from `&` exists only after
compilation:

```scss
// The generated name is `.card__title` — but that string is nowhere in the source.
.card {
  &__title {
    font-size: 20px;
  }
}
```

The markup carries `class="card__title"`. Search the repo for it and you get nothing, so adjusting one
rule means searching a fragment like `__title`, getting every element of every block, and reading the
hits to find the one you meant. On a design system that fragment is in three figures. Write this
instead — same compiled CSS, same specificity, and the name in the stylesheet is the name in the
markup:

```scss
.card {
  padding: 16px;
}
.card__title {
  font-size: 20px;
}
.card--featured {
  border-color: $color-primary-500;
}
```

## The fix that looks right and isn't

Do **not** keep the nesting and just spell the name out inside it:

```scss
.card {
  .card__title {
    font-size: 20px;
  } // ← compiles to `.card .card__title`
}
```

`&` concatenates; a bare selector nests. So this is a **different selector**, not a tidier spelling of
the same one:

| Source                      | Compiles to          | Specificity | Matches                        |
| :-------------------------- | :------------------- | :---------- | :----------------------------- |
| `.card { &__title {} }`     | `.card__title`       | 0,1,0       | the element, anywhere          |
| `.card__title {}`           | `.card__title`       | 0,1,0       | the element, anywhere          |
| `.card { .card__title {} }` | `.card .card__title` | 0,2,0       | only inside `.card` in the DOM |

Two things break. The extra specificity level quietly wins over rules that were meant to override it
(a `.card__title--muted` modifier declared flat now loses). And the element stops being styled the
moment it isn't a DOM descendant — a Vue `<Teleport>` / React portal, a slot or `<template>` rendered
into another subtree, a dropdown or tooltip mounted at `<body>`. That is a bug that ships looking fine
and appears later, which makes it strictly worse than the searchability problem it was meant to solve.

## What `&` is still the right tool for

Keep `&` for the thing only it can do — hanging a state or context off a name that **already exists**.
These build no new name, so they cost nothing to search for, and flattening them by hand just makes
the file longer:

```scss
.card__title {
  &:hover {
    color: $color-primary-600;
  }
  &:focus-visible {
    outline: 2px solid $color-primary-500;
  }
  &.is-truncated {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  &[aria-current='page'] {
    font-weight: 700;
  }
  .theme-dark & {
    color: #fff;
  }
}
```

Nesting a media query, a `:has()`, or a container query inside the rule is fine for the same reason.

## The project always wins

This is the default, not a house style to impose. `component_map` / `token_map` / `analyze_project`
return `profile.styling.classNaming`, read from the project's **own** preprocessor stylesheets
(including SFC `<style lang="scss">` blocks, which on a Vue or Svelte repo are often the only ones):

- **`'ampersand'`** — the project already writes `&__title`. Match it. A generated file that spells
  names the other way is the inconsistency, whatever this page argues.
- **`'flat'`** — the project already writes them in full. Match it (and this default agrees).
- **absent** — the scan found no preprocessor stylesheet, or none declaring a compound class (a
  Tailwind project, or one that only uses single-word classes). There is no habit to match, so write
  flat.

If you are extending an existing stylesheet rather than writing a new one, that file's own spelling
outranks the repo-wide verdict — a plurality across the project says nothing about the file you're
editing.
