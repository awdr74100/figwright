---
name: figma-sync-tokens
description: Sync Figma variables (colors, spacing, typography) into the project's design-token source of truth — Tailwind config, CSS custom properties, or framework-specific token files. Triggers when the user asks to "sync tokens", "update colors from Figma", or after Figma variables change.
min-server-version: 0.1.0
---

# figma-sync-tokens

Status: **M0 placeholder.** Tools referenced below land in M3.

## When to use

Use this skill when the user:

- Wants to import or update design tokens from Figma into code.
- Mentions Figma variables / styles drift from the codebase.
- Renames or restructures a token in Figma and wants the project to follow.

## How to use

1. Call `sync_tokens` to extract Figma variables in a token-tree form.
2. Detect the project's token location (Tailwind `@theme`, CSS custom props, JSON token file, etc.) — server-side helpers do this for you.
3. Produce a diff: added / removed / renamed / value-changed tokens.
4. Apply the diff to the project. Preserve unrelated custom tokens that did not come from Figma.
5. Surface the diff summary to the user before writing — do not silently rewrite token files.

## Rules

- Never flatten token references into raw values; keep semantic names.
- For Tailwind v4 projects, write to the CSS `@theme` block, not a `tailwind.config.js`.
- For renamed tokens, update all call sites in the project — token rename is half-done if call sites still reference the old name.
