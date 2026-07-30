---
name: figma-typings-audit
description: 'Upgrade @figma/plugin-typings and absorb what the new version exposes. Diffs the .d.ts between the installed and the target version (that package ships no changelog), sorts the changes into breakage / new API / silently-added fields, maps each onto the sandbox handlers, the hand-written Zod mirrors in shared, and the tool registry — then bumps the package and builds whatever the user picks. Use whenever the user wants @figma/plugin-typings updated or audited, or asks what a new plugin-typings version would break or newly enable — including a Renovate bump PR for that package.'
---

Absorbing a `@figma/plugin-typings` release into Figwright, end to end: audit → upgrade →
implement what's worth having.

**One hard ordering constraint: diff before upgrading.** The audit compares the *installed* version
against the target, so upgrading first destroys the baseline. (Recoverable — the old version is in
git history and `npm pack` can still fetch it — but don't create the problem.)

Target version: whatever the user named, otherwise the latest on npm.

## Stage 0 — Resolve versions

```bash
grep '@figma/plugin-typings' packages/plugin/package.json          # the declared range
grep '"version"' packages/plugin/node_modules/@figma/plugin-typings/package.json  # what is installed
npm view @figma/plugin-typings version                              # latest
npm view @figma/plugin-typings versions --json                      # how many releases are being skipped
```

Compare against the **installed** version, not the declared range — a caret range can already be
satisfied by something newer than what the lockfile pinned.

If installed and target are equal, say so and stop. Don't spend tokens on the rest.

## Stage 1 — Get the authoritative diff

There is no other source. `figma/plugin-typings` ships **no CHANGELOG and no GitHub Releases** (the
releases API returns an empty array), and its commit messages are content-free (`1.132.0`,
`Release v1.132 updates`). The `.d.ts` diff is the only ground truth.

Work in the session scratchpad directory (`$SCRATCH` below):

```bash
cd "$SCRATCH" && mkdir -p typings-audit && cd typings-audit
npm pack @figma/plugin-typings@<installed> @figma/plugin-typings@<target> --pack-destination .
for v in <installed> <target>; do
  mkdir -p "$v" && tar -xzf "figma-plugin-typings-$v.tgz" -C "$v" --strip-components=1
done
diff -u <installed>/plugin-api.d.ts <target>/plugin-api.d.ts > api.diff
wc -l api.diff
```

Diff **`plugin-api.d.ts`**, not `plugin-api-standalone.d.ts` — `packages/plugin/tsconfig.json` sets
`types: ["@figma/plugin-typings"]`, whose `index.d.ts` references the former.

Also diff `index.d.ts` (it declares the `figma` global, `fetch`, timers) — small, but high blast
radius.

When the jump spans several releases, diff the two endpoints; the cumulative effect is what matters.
Go release-by-release only to attribute a specific change to a version.

## Stage 2 — Classify every hunk

Drop hunks that are **JSDoc-only** (comment/example churn, no signature change) — the file is mostly
documentation and these dominate the line count without meaning anything.

Sort the rest into three buckets:

1. **Breaking** — a removed symbol, a narrowed type (optional → required, union → smaller union), a
   changed signature, or a newly-added `@deprecated`. Look at `-` lines first.
2. **New API** — a new method, node type, enum member, or namespace. A new *capability*, so a
   candidate for a new tool or a new argument on an existing one.
3. **New field on an existing type** — an added property on something Figwright already reads
   (`Paint`, `Effect`, `TextStyle`, a node interface…). ⚠️ **The dangerous bucket.** No compiler will
   ever flag it and the read path will keep silently omitting the dimension. It is this repo's
   recurring bug class: a multi-dimensional Figma property collapsed to one field or dropped on the
   way out.

## Stage 3 — Map the diff onto the repo

The three source trees have completely different exposure. Don't treat them alike:

| Tree                      | Coupling to typings                                                                                                                                                        | Who catches a break |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `packages/plugin/src/**`  | **Real.** The only tree that calls `figma.*` and loads the global types (`tsconfig.json` → `types: ["@figma/plugin-typings"]`)                                              | `tsc`               |
| `packages/plugin/ui/**`   | None — the Vue panel never touches the Figma API                                                                                                                            | n/a, skip           |
| `packages/shared/src/**`  | ★ **None — and that's the trap.** `serialized-node.ts`, `styles.ts`, `queries.ts` are *hand-written Zod mirrors* of Figma shapes; `shared/tsconfig.json` never loads typings | **Nobody but this audit** |

- **Bucket 1** — grep the affected symbols under `packages/plugin/src/` (handlers, `serializer.ts`,
  `traverse.ts`, `reveal.ts`). Confirm with Stage 4 rather than reasoning about it.
- **Bucket 3** — for each added field, check whether the Zod mirror in `packages/shared/src/` carries
  it, and whether `serializer.ts` or `handlers/get-design-context.ts` projects it. A miss here is a
  real fidelity gap with every gate green.
- **Bucket 2** — check coverage against `packages/mcp/src/tools/registry.ts` (`ALL_TOOL_SPECS` is the
  authority on the tool count; prose in READMEs is hand-written and stale).

## Stage 4 — Sandbox typecheck (only if Stage 2 found bucket 1)

Type-check the real sandbox sources against the **new** typings without touching the repo. Never
overwrite the copy in `node_modules` — pnpm hard-links it into the global store, so writing there
corrupts the store for every project on the machine.

Write `$SCRATCH/typings-audit/tsconfig.probe.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": []
  },
  "files": ["./<target>/index.d.ts"],
  "include": [
    "<REPO_ROOT>/packages/plugin/src/**/*.ts",
    "<REPO_ROOT>/packages/plugin/protocol/**/*.ts"
  ]
}
```

Expand `<REPO_ROOT>` to `git rev-parse --show-toplevel` — the tsconfig lives outside the repo, so
those entries have to be absolute. Never hard-code a machine-specific path into a committed file.

`types: []` keeps the installed (old) typings out; the `files` entry pulls the new ones in via its
`/// <reference path="./plugin-api.d.ts" />`. Module resolution still works because it is anchored to
each source file's own location, not to the tsconfig's.

```bash
./node_modules/.bin/tsc -p "$SCRATCH/typings-audit/tsconfig.probe.json"
```

**Run the same probe against the installed version first.** A clean baseline is what makes a failure
on the new version mean something.

## Stage 5 — Decide, then upgrade

- **Anything in bucket 1 → stop and report.** Present what breaks and what it would cost to absorb,
  and let the user decide. Never upgrade past a breaking change on your own initiative.
- **Otherwise upgrade** and prove the tree is still green:

```bash
pnpm -C packages/plugin add -D @figma/plugin-typings@^<target>
pnpm typecheck && pnpm lint && pnpm format:check && pnpm knip && pnpm build && pnpm test
```

This is the first step that writes to the repo — `packages/plugin/package.json` and
`pnpm-lock.yaml`. Everything before it was read-only.

## Stage 6 — Report, then let the user pick

Report in 繁體中文台灣用語, ordered by consequence:

1. **會壞掉的** — symbol, call sites under `packages/plugin/src/`, probe verdict. Say so explicitly
   when the list is empty.
2. **靜默漏接風險** (bucket 3) — added field → the `shared` mirror that lacks it → the projection
   that would need to carry it. Flag that no gate catches these.
3. **新能力** (bucket 2) — one line each: what Figma now exposes, and the smallest change that would
   surface it.

Report only what the diff and the probe actually showed. Don't pad with plausible-sounding changes,
and never claim a live verification you didn't run.

Then `AskUserQuestion` (multi-select) over the items from 2 and 3.

## Stage 7 — Implement the picks

Choosing where a new capability lands is the part worth thinking about:

- **Follow the real usage path, not the closest-sounding tool name.** Ask when an agent would
  actually want this value, and put it on the tool that is already being called at that moment.
- **Keep the semantics honest.** Editor-wide state does not belong inside a per-node object — make it
  a sibling field, and say so in the JSDoc.
- **Smallest change that closes the gap**: a field on an existing result < a new argument < a new
  tool. The tool count is already large; a new tool needs to earn itself.
- A new read dimension usually touches four places: the Zod schema in `packages/shared/src/`, the
  sandbox handler in `packages/plugin/src/handlers/`, the tool description in
  `packages/mcp/src/tools/` (it is the LLM's only spec — fix it if it misreports the shape), and a
  test.
- `exactOptionalPropertyTypes` is on: assign optional fields conditionally
  (`if (x !== undefined) result.x = x`), never `result.x = undefined`.
- Guard editor-dependent APIs on `figma.editorType` rather than try/catch, so reads that
  deliberately don't assert the editor stay non-throwing in FigJam / Dev Mode without swallowing real
  errors.
- **Several handlers have no test file at all.** If the one you touch is bare, write the test file.
- **Attack your own test.** Break the guard on purpose and confirm the test goes red; a test that
  passes either way is decoration. Then put it back.

Re-run all six gates when done.

## Stage 8 — Hand off the live verification

Unit tests don't prove a read path works against real Figma. Before claiming anything:

- The MCP server runs the **built `dist`** → `pnpm build`, then the user reconnects the MCP server.
- The plugin sandbox runs the dist it loaded **at launch** → the user must close and reopen the
  plugin inside Figma. Reconnecting MCP alone is not enough.
- **Some values can't be verified automatically at all** — anything reflecting editor UI state (an
  open timeline, a playhead, a viewport) can be read but not staged through the plugin API. Design a
  contrast instead of a single reading: measure once in the neutral state, have the user set up the
  state, then measure again. A lone "field is absent" is unreadable — it can't distinguish "the
  plugin never reloaded" from "the state genuinely isn't there".
- Building probe material on the canvas writes to the user's file. Ask first, and delete it after.

Report what was actually run. If the live step didn't happen, say that.
