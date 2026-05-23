---
name: figma-audit
description: Audit the implementation against a Figma design — flag missing components, drift between design tokens and code, accessibility gaps, and mapping inconsistencies. Triggers when the user asks to "check this against Figma", "find what's missing", or "audit the design implementation".
min-server-version: 0.1.0
---

# figma-audit

Status: **M0 placeholder.** Tools referenced below land in M3–M4.

## When to use

Use this skill when the user:

- Has finished an implementation and wants to verify it against the Figma source.
- Reports "this doesn't look right" without specifics.
- Is preparing a release and wants a design-implementation parity check.

## How to use

1. Call `audit_mapping` with the project root and the Figma node id.
2. Call `extract_a11y_hints` to gather semantic / accessibility expectations from the Figma frame.
3. Compare: component coverage, token usage, spacing/sizing, a11y attributes.
4. Produce a categorized report:
   - **Critical**: missing components, wrong tokens used.
   - **Should fix**: spacing drift, accessibility gaps.
   - **Nice to have**: minor style differences likely intentional.
5. Do not auto-fix unless the user asks. Surface, then propose.

## Rules

- Be specific: cite file paths + line numbers, and Figma node ids.
- Do not flag intentional deviations the user has already approved in conversation.
- If the Figma design and code disagree, ask which is the source of truth before "fixing".
