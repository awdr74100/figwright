---
name: mcp-sdk-audit
description: 'Upgrade @modelcontextprotocol/sdk and prove the wire contract survived. The SDK is a runtime dependency whose breakage lands on the wire, not in the type checker — so this sorts each release by which SDK source files it touched (Figwright uses only the server + stdio slice of a client/server/multi-transport package), then snapshots what a real MCP client observes — negotiated protocol version, every tool JSON Schema, annotations, prompts — before and after the bump and diffs them. Use whenever the user wants @modelcontextprotocol/sdk updated or audited, asks what a new SDK version changes for the server or its clients, or lands on a Renovate bump PR for that package.'
---

Absorbing a `@modelcontextprotocol/sdk` release into Figwright, end to end: audit → upgrade → prove
the wire contract is unchanged.

**Do not reason about this the way `figma-typings-audit` reasons about plugin typings.** That package
is types-only, so `tsc` is a real gate. This one is a **runtime dependency**: it serializes every
tool result, generates the JSON Schema for all ~112 tools, and negotiates the protocol version. A
release can leave every type identical and still change what clients see. `pnpm typecheck` will stay
green through it.

**The repo has no gate that covers this.** `packages/mcp/test/e2e/` exercises the relay/plugin side
and never starts an MCP server; `packages/mcp/test/tool-schema.ts` derives schemas with `z.toJSONSchema`
directly — a *parallel* implementation of what `McpServer` does through
`server/zod-json-schema-compat.js`, not an observation of it. Both stay green while the wire moves.
Stage 5 is where the actual verification happens.

Target version: whatever the user named, otherwise the latest 1.x on npm.

## Stage 0 — Resolve versions, and check which major

```bash
grep '@modelcontextprotocol/sdk' packages/mcp/package.json   # declared range
grep -m1 '@modelcontextprotocol/sdk@' pnpm-lock.yaml         # what is installed
npm view @modelcontextprotocol/sdk version dist-tags --json  # latest
gh api repos/modelcontextprotocol/typescript-sdk/releases --jq '.[0:15][] | "\(.tag_name)\t\(.published_at)"'
```

The releases list interleaves **two product lines**: bare `1.30.0`-style tags (this package) and
`@modelcontextprotocol/server@2.0.0`-style tags (the 2.x rewrite, published as *separate packages* —
`@modelcontextprotocol/server`, `/node`, `/hono`, `/server-legacy`). A 2.x tag is **not** an upgrade
path for `@modelcontextprotocol/sdk`; it is a migration to different packages with a different API.
If the user is pointing at 2.x, stop and say so — that is a project decision, not a bump.

If installed and target are equal, say so and stop.

## Stage 1 — Read the release notes as an index, not as an answer

Unlike `@figma/plugin-typings`, this package **does** ship GitHub Releases. But the body is an
auto-generated list of PR titles, written for SDK contributors: it says *what was changed*, never
*who is affected*. "v1 stdio buffer limit" reads like it belongs to whoever runs stdio; the useful
question is which of `client/`, `server/`, `shared/` it landed in.

So use the notes only to get the PR numbers, then ask each PR what it touched:

```bash
gh api repos/modelcontextprotocol/typescript-sdk/releases --jq '.[] | select(.tag_name=="<target>") | .body'
# then, per PR number in that body:
gh pr view <n> --repo modelcontextprotocol/typescript-sdk --json title,files \
  --jq '"\(.title)\n  " + (.files | map(.path) | join("\n  "))'
```

⚠️ **Read the whole file list, never just the first entry.** The stdio, transport, and schema changes
routinely land in three places at once (`src/client/x.ts`, `src/server/x.ts`, `src/shared/x.ts`).
Judging PR #2239 by its first file said "client only"; its `src/server/stdio.ts` hunk was the one
that mattered.

## Stage 2 — Sort by file path

Figwright imports exactly three entry points (`packages/mcp/src/index.ts`, `src/prompts/*`,
`test/tool-schema.ts`): `server/mcp.js`, `server/stdio.js`, `types.js`. That narrow slice is what
makes this audit cheap — most of any given release is about parts of the package this server never
loads.

| SDK path                                                          | Bearing on Figwright                                                                                 |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `src/server/mcp.ts`, `src/server/index.ts`                        | **Load-bearing.** `registerTool` / `registerPrompt` / result serialization                             |
| `src/server/stdio.ts`, `src/shared/stdio.ts`                      | **Load-bearing.** The only transport this server runs                                                  |
| `src/server/zod-compat.ts`, `src/server/zod-json-schema-compat.ts` | **Load-bearing and invisible.** Turns `spec.inputShape` into the JSON Schema every client reads        |
| `src/types.ts`                                                    | **Load-bearing.** Protocol version constants, `CallToolResult`, `ToolAnnotations`                      |
| `src/client/**`                                                   | Not ours — but it is what Claude Code / Cursor run *against* us, so a client-side limit still bites    |
| `src/server/streamableHttp.ts`, `webStandardStreamableHttp.ts`, `sse*` | Unused today (stdio only). Relevant only to the Streamable HTTP roadmap — note, don't act         |
| `src/server/auth/**`, `src/examples/**`, `test/**`, `.github/**`  | Ignore                                                                                                 |

The `src/client/**` row is the subtle one: a limit added to the client's read path applies to
**Figwright's responses**, since the client is what reads them. `get_screenshot` returns inline
base64 and `get_design_context` returns large JSON, so client-side ceilings are a real exposure even
though Figwright ships no client.

## Stage 3 — Cross-check against the published dist

The PR list is a claim about the release; the tarball is the release. Confirm they agree — and catch
anything that reached the build without a listed PR:

```bash
cd "$SCRATCH" && mkdir -p mcp-sdk-audit && cd mcp-sdk-audit
npm pack @modelcontextprotocol/sdk@<installed> @modelcontextprotocol/sdk@<target> --pack-destination .
for v in <installed> <target>; do
  mkdir -p "$v" && tar -xzf "modelcontextprotocol-sdk-$v.tgz" -C "$v" --strip-components=1
done
diff -ru --exclude='*.map' <installed>/dist/esm <target>/dist/esm > esm.diff
grep '^diff ' esm.diff        # the file list — compare against Stage 2
```

`dist/esm/**/*.d.ts` hunks are the type-level surface (what `tsc` would catch); `.js` hunks with no
`.d.ts` counterpart are the dangerous kind — **behavior changed, signature didn't**.

Also diff `package.json` between the two versions: `engines.node`, `peerDependencies` (zod's
supported range), and `dependencies` all move without appearing in the source diff.

## Stage 4 — Classify

1. **Type-level** — a changed export in `dist/esm/**/*.d.ts` that Figwright names. `tsc` covers these;
   confirm in Stage 6 rather than reasoning about them.
2. **★ Wire behavior** — no gate anywhere. The recurring shapes:
   - the negotiated **protocol version** (`LATEST_PROTOCOL_VERSION` / `SUPPORTED_PROTOCOL_VERSIONS` in
     `types.js`) — moving it changes what every connecting client sees, and dropping an old entry can
     cut off an older client outright;
   - the **JSON Schema** generated per tool — Figwright advertises ~112 of them, they are the LLM's
     entire spec, and a `$ref`/`allOf`/`additionalProperties` shift has broken third-party clients
     before (see `project_moonshot_ref_immunity`);
   - **stdio framing and buffering** — message size ceilings, chunk handling, error-on-overflow;
   - **error and result serialization** — what a tool-call rejection looks like to the model.
3. **Dependency / supply chain** — `engines.node` vs the repo's `^20.19.0 || >=22.12.0`, the zod peer
   range against `zod@^4`, transitive advisories. `pnpm install` enforces a supply-chain policy, so
   note what it flags.

Bucket 2 is the whole reason this skill exists. Never claim a bucket-2 item is safe from the diff
alone — Stage 5 settles it.

## Stage 5 — Wire probe (run the baseline *before* the bump)

`.claude/skills/mcp-sdk-audit/probe.mjs` boots `packages/mcp/dist/index.mjs` over stdio, speaks raw
newline-delimited JSON-RPC at it, and writes a snapshot: negotiated protocol version (both as a
newest-client and as a 2024-11-05 client), capabilities, every tool's JSON Schema plus a short hash,
annotations, prompts, and one real `tools/call`.

It deliberately does **not** use the SDK's own `Client`. A probe built out of the package under test
can hide that package's regression — if both sides change together, the snapshot stays identical and
says nothing.

```bash
REPO=$(git rev-parse --show-toplevel)
pnpm build                                                   # the probe reads dist, not src
node "$REPO/.claude/skills/mcp-sdk-audit/probe.mjs" "$REPO" "$SCRATCH/mcp-sdk-audit/base.json"
# ...upgrade (Stage 6), pnpm build again, then:
node "$REPO/.claude/skills/mcp-sdk-audit/probe.mjs" "$REPO" "$SCRATCH/mcp-sdk-audit/after.json"
node "$REPO/.claude/skills/mcp-sdk-audit/probe.mjs" --diff "$SCRATCH/mcp-sdk-audit/base.json" "$SCRATCH/mcp-sdk-audit/after.json"
```

Notes that matter:

- **`pnpm build` first, every time.** The MCP server runs the built `dist`; probing a stale bundle
  reports the previous SDK.
- The probe runs the server on a random high port via `FIGWRIGHT_PORT`, so it never contends for
  `3055` or steals a connected plugin. It needs no plugin — `ping` answers without one.
- A baseline captured *after* upgrading is worthless. If the bump already happened (a Renovate
  branch), take the baseline from `main`: `git stash` or a `git worktree` at the pre-bump commit,
  build, probe, then come back.

## Stage 6 — Upgrade and run the gates

```bash
pnpm -C packages/mcp add @modelcontextprotocol/sdk@^<target>
pnpm typecheck && pnpm lint && pnpm format:check && pnpm knip && pnpm build && pnpm test
```

This and the lockfile are the only writes to the repo; everything before was read-only. All six gates
green plus an empty probe diff is the pass condition — **neither alone is one**.

## Stage 7 — Report in 繁體中文台灣用語

Ordered by consequence:

1. **線上契約有沒有動** — the probe diff: protocol version, tool count, per-tool schema hashes,
   annotations, prompts. Name the tools that changed, or state plainly that none did.
2. **會壞掉的** — bucket 1, with the gate verdict.
3. **要知道但不用動的** — bucket 2/3 items that exist in the release but cannot reach this server
   (a client-side limit, an HTTP transport fix). Say *why* it cannot reach us; that reasoning is the
   deliverable, and it is what makes the next audit cheap.
4. **新能力** — anything the SDK now exposes that Figwright could use, one line each.

Report only what the diff and the probe showed. Don't pad with plausible-sounding changes, and never
claim a verification you didn't run.

Then `AskUserQuestion` over the items from 3 and 4 that would need work.

## Stage 8 — Hand off the live verification

The probe proves the server speaks correctly to a probe. It does not prove real clients are happy:

- The MCP server runs the built `dist` → `pnpm build`, then the user reconnects the MCP connection
  (`.mcp.json` launches `packages/mcp/dist/index.mjs`).
- Ask the user to run one read tool (`ping`, then something with a real payload like
  `get_design_context`) through the reconnected server with the plugin open.
- If the release touched protocol-version constants or schema generation, that check should ideally
  happen in **more than one client** — Claude Code, Cursor, Codex ship different SDK versions, and
  the failure mode is exactly a version mismatch between the two ends.

Say what was actually run. If the live step didn't happen, say that.
