---
name: mcp-sdk-audit
description: 'Upgrade @modelcontextprotocol/server (the MCP TypeScript SDK v2) and prove the wire contract survived. The SDK is a runtime dependency whose breakage lands on the wire, not in the type checker — so this sorts each release by which SDK source files it touched (Figwright uses only the server + stdio slice of a client/server/multi-runtime package family), then diffs what a real MCP client observes — negotiated protocol version, every tool JSON Schema, annotations, prompts — before and after the bump. Use whenever the user wants @modelcontextprotocol/server or the other @modelcontextprotocol/* packages updated or audited, asks what a new SDK version changes for the server or its clients, or lands on a Renovate bump PR for that package.'
---

Absorbing a `@modelcontextprotocol/server` release into Figwright, end to end: audit → upgrade → prove
the wire contract is unchanged.

**Do not reason about this the way `figma-typings-audit` reasons about plugin typings.** That package
is types-only, so `tsc` is a real gate. This one is a **runtime dependency**: it serializes every
tool result, generates the JSON Schema for all ~112 tools, and negotiates the protocol version. A
release can leave every type identical and still change what clients see. `pnpm typecheck` will stay
green through it.

**Unlike every other dependency here, this one has a dedicated gate — use it.**
`packages/mcp/test/e2e/mcp-wire.test.ts` spawns the built `dist` over real stdio, speaks raw
JSON-RPC at it, and asserts the advertised contract against what the specs declare. It runs in
`pnpm test`. That gate answers *did anything break*; it does not answer *what moved*, which is what
an audit is for — Stage 5 covers the difference.

**Know the one thing that gate cannot see.** Its schema check compares the SDK's output against
`test/tool-schema.ts`'s derivation, and both call the same `z.toJSONSchema`. That is independent of
the *SDK* — it catches an SDK that stops asking Zod the same question — but not of *Zod*: when Zod
changes what it answers, both sides move together and the equality still holds. An SDK bump that
also moves the resolved `zod` version (its range is `^4.2.0`, so it shares the repo's copy) can
therefore reshape every client's schema with this gate green.
`packages/mcp/test/json-schema-generation.test.ts` covers that half by pinning each construct's
rendering by hand — if a bump moves the Zod version, read its diff too, and let `probe.mjs` name
which tools changed.

Target version: whatever the user named, otherwise the latest `@modelcontextprotocol/server` on npm.

## Stage 0 — Resolve versions

```bash
grep '@modelcontextprotocol' packages/mcp/package.json          # declared range
grep -m1 '@modelcontextprotocol/server@' pnpm-lock.yaml         # what is installed
npm view @modelcontextprotocol/server version dist-tags --json  # latest
gh api repos/modelcontextprotocol/typescript-sdk/releases --jq '.[0:15][] | "\(.tag_name)\t\(.published_at)"'
```

Figwright is on **v2** — the package family (`@modelcontextprotocol/server` + its transitive
`/core`, with `/client`, `/node`, `/express`, `/hono`, `/fastify`, `/server-legacy`, `/codemod`
alongside). It depends on exactly one of them.

Two things the releases list will show that are **not** upgrades for us:

- Bare `1.30.0`-style tags are the **v1 legacy line** (`@modelcontextprotocol/sdk`, source on the
  long-lived `v1.x` branch). Figwright left it; a v1 tag is not our concern.
- `@modelcontextprotocol/{client,express,fastify,hono,node,server-legacy,codemod}@X` tags ship on
  the same version number as `server` but are packages we do not install.

If installed and target are equal, say so and stop.

## Stage 1 — Read the release notes as an index, not as an answer

The GitHub Releases body is an auto-generated list of PR titles, written for SDK contributors: it
says *what was changed*, never *who is affected*. "stdio buffer limit" reads like it belongs to
whoever runs stdio; the useful question is which package and which directory it landed in.

So use the notes only to get the PR numbers, then ask each PR what it touched:

```bash
gh api repos/modelcontextprotocol/typescript-sdk/releases --jq '.[] | select(.tag_name=="@modelcontextprotocol/server@<target>") | .body'
# then, per PR number in that body:
gh pr view <n> --repo modelcontextprotocol/typescript-sdk --json title,files \
  --jq '"\(.title)\n  " + (.files | map(.path) | join("\n  "))'
```

⚠️ **Read the whole file list, never just the first entry.** v2 splits one concern across packages
by design — a wire change routinely lands in `packages/core-internal/src/wire/`,
`packages/server/src/server/`, and `packages/client/src/` at once. Judging a PR by its first file
is how the hunk that mattered gets missed.

## Stage 2 — Sort by file path

Figwright imports exactly two entry points (`packages/mcp/src/index.ts`, `src/prompts/*`,
`test/tool-schema.ts`, `test/e2e/mcp-wire.test.ts`): `@modelcontextprotocol/server` and
`@modelcontextprotocol/server/stdio`. That narrow slice is what makes this audit cheap — most of any
given release is about parts of the family this server never loads.

| SDK path                                                           | Bearing on Figwright                                                                              |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `packages/server/src/server/mcp.ts`, `server.ts`                   | **Load-bearing.** `registerTool` / `registerPrompt` / result serialization                          |
| `packages/server/src/server/serveStdio.ts`, `stdio.ts`             | **Load-bearing.** The entry point and the only transport this server runs                           |
| `packages/server/src/fromJsonSchema.ts`, `validators/`             | **Load-bearing and invisible.** Turns each spec's Zod object into the JSON Schema every client reads |
| `packages/core-internal/src/wire/`, `types/`                       | **Load-bearing.** Protocol version constants, per-era codecs, `CallToolResult`, `ToolAnnotations`   |
| `packages/core/src/`                                               | Schema constants + types. We import types only through `server`'s re-export; watch renames          |
| `packages/client/**`                                               | Not ours — but it is what Claude Code / Cursor run *against* us, so a client-side limit still bites  |
| `packages/server/src/server/streamableHttp.ts`, `perRequestTransport.ts`, `createMcpHandler.ts` | Unused today (stdio only). Relevant only to a future HTTP transport — note, don't act |
| `packages/{express,fastify,hono,node,server-legacy}/**`, `**/auth/**`, `examples/**` | Ignore                                                            |

The `packages/client/**` row is the subtle one: a limit added to the client's read path applies to
**Figwright's responses**, since the client is what reads them. `get_screenshot` returns inline
base64 and `get_design_context` returns large JSON, so client-side ceilings are a real exposure even
though Figwright ships no client.

## Stage 3 — Cross-check against the published dist

The PR list is a claim about the release; the tarball is the release. Confirm they agree — and catch
anything that reached the build without a listed PR:

```bash
cd "$SCRATCH" && mkdir -p mcp-sdk-audit && cd mcp-sdk-audit
npm pack @modelcontextprotocol/server@<installed> @modelcontextprotocol/server@<target> \
         @modelcontextprotocol/core@<installed> @modelcontextprotocol/core@<target> \
         --pack-destination .
for p in server core; do for v in <installed> <target>; do
  mkdir -p "$p-$v" && tar -xzf "modelcontextprotocol-$p-$v.tgz" -C "$p-$v" --strip-components=1
done; done
diff -ru --exclude='*.map' server-<installed>/dist server-<target>/dist > server.diff
grep '^diff ' server.diff        # the file list — compare against Stage 2
```

v2 emits `.mjs`/`.cjs` siblings in a flat `dist/` with **content-hashed chunk names**
(`dist/mcp-DXXb3Vv3.mjs`), so a chunk filename changing between versions is noise, not signal — diff
by content, and expect the whole-file rename churn. `dist/**/*.d.mts` hunks are the type-level
surface (what `tsc` would catch); `.mjs` hunks with no `.d.mts` counterpart are the dangerous kind —
**behavior changed, signature didn't**.

Also diff `package.json` between the two versions: `engines.node`, `dependencies` (the pinned
`@modelcontextprotocol/core` version and zod's supported range) all move without appearing in the
source diff. v2 declares `zod` as a real **dependency**, not a peer — a range bump there can nest a
second zod copy beside the repo's own.

## Stage 4 — Classify

1. **Type-level** — a changed export in `dist/**/*.d.mts` that Figwright names. `tsc` covers these;
   confirm in Stage 6 rather than reasoning about them.
2. **★ Wire behavior** — the recurring shapes:
   - the negotiated **protocol version** (`LATEST_PROTOCOL_VERSION`, `SUPPORTED_PROTOCOL_VERSIONS`,
     `FIRST_MODERN_PROTOCOL_VERSION`) — moving it changes what every connecting client sees, and
     dropping an old entry can cut off an older client outright;
   - the **JSON Schema** generated per tool — Figwright advertises ~112 of them, they are the LLM's
     entire spec, and a `$ref`/`allOf`/`additionalProperties` shift has broken third-party clients
     before (see `project_moonshot_ref_immunity`);
   - **era selection in `serveStdio`** — which revision a given opening exchange lands on;
   - **stdio framing and buffering** — message size ceilings, chunk handling, error-on-overflow;
   - **error and result serialization** — what a tool-call rejection looks like to the model.
3. **Dependency / supply chain** — `engines.node` vs the repo's `^20.19.0 || >=22.12.0`, the zod
   range against `zod@^4`, transitive advisories. Note what `pnpm install` flags.

Bucket 2 is the whole reason this skill exists. Never claim a bucket-2 item is safe from the diff
alone — Stage 5 settles it.

## Stage 5 — Run the gate, then diff the delta

Two different questions, two tools. Run both.

**The gate — did anything break?**

```bash
pnpm build && pnpm vitest run packages/mcp/test/e2e/mcp-wire.test.ts
```

It asserts the advertised tool set, each tool's JSON Schema against a derivation that is independent
of the SDK (but not of Zod — see above), the dialect, annotations, prompts, a live `tools/call`, the
bad-argument path, and that a 2024-11-05 client is still served. Red here means the release moved
something that matters. If the bump also moved `zod`, run
`pnpm vitest run packages/mcp/test/json-schema-generation.test.ts` as a second gate.

**The probe — what moved?** A gate is a boolean; an audit has to name the change. `probe.mjs` boots
the same built server, snapshots everything a client can observe, and diffs two snapshots.

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
  reports the previous SDK. (A stale `dist` left behind by an abandoned upgrade is also
  *unrunnable* — it imports a package the current `node_modules` no longer has.)
- Both the gate and the probe run the server on a random high port via `FIGWRIGHT_PORT`, so neither
  contends for `3055` or steals a connected plugin. Neither needs a plugin — `ping` answers without
  one.
- A baseline captured *after* upgrading is worthless. If the bump already happened (a Renovate
  branch), take the baseline from `main` in a `git worktree`, `pnpm install`, build, probe, then come
  back. `probe.mjs` reads the installed version out of the lockfile, so a v1 baseline needs that one
  regex pointed at `@modelcontextprotocol/sdk@`.

## Stage 6 — Upgrade and run the gates

```bash
pnpm -C packages/mcp add @modelcontextprotocol/server@^<target>
pnpm typecheck && pnpm lint && pnpm format:check && pnpm knip && pnpm build && pnpm test
```

This and the lockfile are the only writes to the repo; everything before was read-only. All six
gates green **and** an empty probe diff is the pass condition — neither alone is one, though the six
now include the wire gate, which is what made them worth trusting.

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

The gate and the probe prove the server speaks correctly to a test harness. They do not prove real
clients are happy:

- The MCP server runs the built `dist` → `pnpm build`, then the user reconnects the MCP connection
  (`.mcp.json` launches `packages/mcp/dist/index.mjs`).
- Ask the user to run one read tool (`ping`, then something with a real payload like
  `get_design_context`) through the reconnected server with the plugin open.
- If the release touched protocol-version constants or schema generation, that check should ideally
  happen in **more than one client** — Claude Code, Cursor, Codex ship different SDK versions (many
  still on v1), and the failure mode is exactly a version mismatch between the two ends.

Say what was actually run. If the live step didn't happen, say that.
