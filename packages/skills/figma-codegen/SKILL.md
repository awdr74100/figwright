---
name: figma-codegen
description: Generate framework-aware code from a Figma selection. Reads the user's project profile and emits code that matches the existing stack (Vue/React/Blade/Razor/Django templates). Triggers when the user asks to "code this design", "build this component", or references a Figma URL.
min-server-version: 0.1.0
---

# figma-codegen

Status: **M0 placeholder.** Tools referenced below land in M3.

## When to use

Use this skill when the user:

- Pastes a Figma URL or selection and asks for code.
- Says "make this", "build this component", "implement this design".
- Wants to extend an existing component in the project to match a Figma frame.

## How to use

1. Call `get_ui_ir` on the current Figma selection to get the structural intermediate representation.
2. Call `get_semantic_html` for the language-agnostic semantic HTML view.
3. Inspect the project root to determine the active stack (server-side helper `analyze_project` runs automatically — you do not need to invoke it).
4. Emit code in the user's framework. Match their file structure, import style, and naming conventions exactly — do not impose a house style.
5. When tokens (colors, spacing, typography) appear, prefer the project's design-token names over hex/px values.

## Rules

- Never write a config file or wizard prompt; figure things out from the project.
- If the project profile is ambiguous, fall back to semantic HTML + a short note explaining the assumption.
- Do not invent component names; reuse what `component_map` reports.
