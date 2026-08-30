# Changelog

## v0.5.0

[compare changes](https://github.com/awdr74100/figwright/compare/v0.4.0...v0.5.0)

### 🚀 Enhancements

- **text:** Read and write textWrapStyle across nodes, runs and text styles ([#147](https://github.com/awdr74100/figwright/pull/147))
- **tokens:** Read Tailwind v3 JS configs as a project token source ([#148](https://github.com/awdr74100/figwright/pull/148))
- **tokens:** Read UnoCSS configs as a project token source ([#149](https://github.com/awdr74100/figwright/pull/149))
- **tokens:** Read SCSS variables as a project token source ([#151](https://github.com/awdr74100/figwright/pull/151))
- **tokens:** Tell the caller when a token build tool wrote the tokens somewhere pruned ([#152](https://github.com/awdr74100/figwright/pull/152))
- Carry export bytes as msgpack bin instead of base64 ([#156](https://github.com/awdr74100/figwright/pull/156))
- Carry variable bindings through the write path ([#167](https://github.com/awdr74100/figwright/pull/167))
- **codegen:** Ground BEM class-name spelling instead of defaulting to `&` ([#175](https://github.com/awdr74100/figwright/pull/175))
- **codegen:** Derive a linear gradient's CSS angle from the node it fills ([#177](https://github.com/awdr74100/figwright/pull/177))
- Validate tool arguments where they enter the relay, and complete the shutdown triggers ([#188](https://github.com/awdr74100/figwright/pull/188))

### 🩹 Fixes

- **scan:** Read SFC script blocks with a scanner instead of a regex ([#144](https://github.com/awdr74100/figwright/pull/144))
- **walk:** Return repo files in a deterministic order ([#153](https://github.com/awdr74100/figwright/pull/153))
- **tokens:** Report a token build tool's output even when other tokens were found ([#154](https://github.com/awdr74100/figwright/pull/154))
- **election:** Recover from a leader that holds the port but stops answering ([#159](https://github.com/awdr74100/figwright/pull/159))
- **design-context:** Stop handing codegen a coordinate dump when a tree is over budget ([#162](https://github.com/awdr74100/figwright/pull/162))
- Stop dropping the variables a style's paints and effects bind ([#166](https://github.com/awdr74100/figwright/pull/166))
- Load a text style's font before writing it, and let its typography bind to variables ([#168](https://github.com/awdr74100/figwright/pull/168))
- **plugin-ui:** Stop a tab switch from flashing a scrollbar ([#171](https://github.com/awdr74100/figwright/pull/171))
- **plugin:** Load the node font before every set_text_properties write ([#180](https://github.com/awdr74100/figwright/pull/180))
- **plugin:** Stop a resize drag from depending on pointer capture holding ([#189](https://github.com/awdr74100/figwright/pull/189))

### 📖 Documentation

- Add the Trendshift badge ([#181](https://github.com/awdr74100/figwright/pull/181))
- Overhaul the README front page, add a Code of Conduct ([#184](https://github.com/awdr74100/figwright/pull/184))

### 🏡 Chore

- **format:** Exclude the generated CHANGELOG from oxfmt ([#140](https://github.com/awdr74100/figwright/pull/140))

### ✅ Tests

- **mcp:** Gate era dispatch with the ping 2026-07-28 deleted ([#146](https://github.com/awdr74100/figwright/pull/146))
- **contract:** Close the local-tool hole in the plugin argument gate ([#157](https://github.com/awdr74100/figwright/pull/157))
- Close the two races behind the intermittent CI failure ([#160](https://github.com/awdr74100/figwright/pull/160))
- **text-style:** Pin the multi-mode font preload, now that it can be measured ([#169](https://github.com/awdr74100/figwright/pull/169))

### 🤖 CI

- Split the gate into a lint job and an OS matrix ([#163](https://github.com/awdr74100/figwright/pull/163))

### ❤️ Contributors

- Roya ([@awdr74100](https://github.com/awdr74100))

## v0.4.0

[compare changes](https://github.com/awdr74100/figwright/compare/v0.3.0...v0.4.0)

### 🚀 Enhancements

- Add Figma Motion API tools and animated-frame video export ([#78](https://github.com/awdr74100/figwright/pull/78))
- **plugin:** Rebuild the panel — theme-aware, component-based, and able to point at the canvas ([#101](https://github.com/awdr74100/figwright/pull/101))
- **motion:** Expose the Motion playhead on get_node_motion ([#114](https://github.com/awdr74100/figwright/pull/114))
- **mcp:** ⚠️  Migrate to MCP SDK v2 and gate the wire contract ([#127](https://github.com/awdr74100/figwright/pull/127))

### 🩹 Fixes

- **mcp:** Eliminate zombie leaders via shutdown hardening and newest-build-wins election ([#72](https://github.com/awdr74100/figwright/pull/72))
- Gate the local relay against cross-site and DNS-rebinding access ([#96](https://github.com/awdr74100/figwright/pull/96))
- Make @figwright/mcp bin-only so a stray import can't seize the relay port ([#98](https://github.com/awdr74100/figwright/pull/98))
- **plugin:** Let an in-flight call be opened to see what it was asked to do ([#104](https://github.com/awdr74100/figwright/pull/104))
- **plugin:** Rework the panel's window controls — resize grip and run-in-background ([#105](https://github.com/awdr74100/figwright/pull/105))
- **screenshot:** Cap exports at what a vision model resolves ([#115](https://github.com/awdr74100/figwright/pull/115))
- Enable plugin to run in Dev Mode handoff panel ([#116](https://github.com/awdr74100/figwright/pull/116))
- **plugin:** Honour what each editor's API actually allows ([#118](https://github.com/awdr74100/figwright/pull/118))
- **join:** Ground component reuse in what the code actually declares ([#125](https://github.com/awdr74100/figwright/pull/125))
- **mcp:** Cap the bytes get_screenshot inlines in one batch ([#128](https://github.com/awdr74100/figwright/pull/128))
- **mcp:** Exit when the stdio transport dies instead of lingering deaf ([#129](https://github.com/awdr74100/figwright/pull/129))
- **variables:** Read EASING values as curves instead of a fabricated color ([#131](https://github.com/awdr74100/figwright/pull/131))
- **relay:** ⚠️  Warn the agent when the Figma plugin is out of date ([#134](https://github.com/awdr74100/figwright/pull/134))
- **release:** Back out of a prompt without a stack trace ([8a15234](https://github.com/awdr74100/figwright/commit/8a15234))
- **tokens:** Read CSS custom properties with a scanner instead of a regex ([#137](https://github.com/awdr74100/figwright/pull/137))
- **tools:** ⚠️  Scope find_replace_text with root, not rootId ([#138](https://github.com/awdr74100/figwright/pull/138))
- **plugin:** Restore the Activity list's bottom gap and make the whole row open ([#139](https://github.com/awdr74100/figwright/pull/139))

### 💅 Refactors

- Read the plugin version via a JSON import attribute ([#99](https://github.com/awdr74100/figwright/pull/99))
- **plugin:** Draw the panel's module boundaries around responsibility ([#102](https://github.com/awdr74100/figwright/pull/102))
- **plugin:** Move the iframe bridge protocol out of shared ([#103](https://github.com/awdr74100/figwright/pull/103))
- **plugin:** Hoist the required prop key out of the `in` check ([#113](https://github.com/awdr74100/figwright/pull/113))

### 📖 Documentation

- Sync glama.json to canonical description, refresh AGENTS.md facts ([#82](https://github.com/awdr74100/figwright/pull/82))
- Add security policy with private reporting channel and security model ([#83](https://github.com/awdr74100/figwright/pull/83))

### 🏡 Chore

- **github:** Add issue and PR templates ([#70](https://github.com/awdr74100/figwright/pull/70))
- **github:** Add social preview images ([#71](https://github.com/awdr74100/figwright/pull/71))
- Drop renovate schedule, lower minimumReleaseAge to 1 day ([#85](https://github.com/awdr74100/figwright/pull/85))
- Switch renovate to recommended + rangeStrategy bump ([#88](https://github.com/awdr74100/figwright/pull/88))
- Pin node in renovate, drop redundant engines.pnpm ([#89](https://github.com/awdr74100/figwright/pull/89))
- **mcp:** Drop sourcemap output from the published build ([#106](https://github.com/awdr74100/figwright/pull/106))
- **plugin:** Raise build target from es2017 to Vite's baseline default ([#107](https://github.com/awdr74100/figwright/pull/107))
- **plugin:** Align tsconfig target with its own lib array ([#108](https://github.com/awdr74100/figwright/pull/108))
- Point oxfmt's Tailwind sorter at the panel's own stylesheet ([#109](https://github.com/awdr74100/figwright/pull/109))
- Normalise line endings to LF for every clone ([#121](https://github.com/awdr74100/figwright/pull/121))
- **release:** Pick the version from a menu instead of typing it by hand ([#132](https://github.com/awdr74100/figwright/pull/132))
- **skills:** Drop the vendored create-readme and skill-creator ([#133](https://github.com/awdr74100/figwright/pull/133))

### ✅ Tests

- **relay:** De-flake heartbeat close test, add deterministic ping coverage ([#79](https://github.com/awdr74100/figwright/pull/79))
- **mcp:** Cover the two server-local tool handlers ([#130](https://github.com/awdr74100/figwright/pull/130))

### 🤖 CI

- Add actionlint workflow ([#74](https://github.com/awdr74100/figwright/pull/74))
- Capitalize actionlint workflow name ([#75](https://github.com/awdr74100/figwright/pull/75))
- Harden workflows per zizmor audit, add zizmor and renovate ([#76](https://github.com/awdr74100/figwright/pull/76))

#### ⚠️ Breaking Changes

- **mcp:** ⚠️  Migrate to MCP SDK v2 and gate the wire contract ([#127](https://github.com/awdr74100/figwright/pull/127))
- **relay:** ⚠️  Warn the agent when the Figma plugin is out of date ([#134](https://github.com/awdr74100/figwright/pull/134))
- **tools:** ⚠️  Scope find_replace_text with root, not rootId ([#138](https://github.com/awdr74100/figwright/pull/138))

### ❤️ Contributors

- Roya ([@awdr74100](https://github.com/awdr74100))
- Yueyuemuzi <605181746@qq.com>

## v0.3.0

[compare changes](https://github.com/awdr74100/figwright/compare/v0.2.0...v0.3.0)

### 🚀 Enhancements

- **get_design_context:** Surface mixed-text segments + WRAP cross-axis spacing, omit no-op defaults ([#14](https://github.com/awdr74100/figwright/pull/14))
- **set_layout_props:** Set layoutSizingHorizontal/Vertical (HUG/FILL/FIXED) ([#19](https://github.com/awdr74100/figwright/pull/19))
- **set_position:** Add set_position tool for exact node placement ([#20](https://github.com/awdr74100/figwright/pull/20))
- **ping:** Surface leader/follower version skew (zombie-leader warning) ([#21](https://github.com/awdr74100/figwright/pull/21))
- **figma-build:** Ground build values in source code + a sensible scale ([#23](https://github.com/awdr74100/figwright/pull/23))
- **get_design_context:** Carry non-text overrides on deduped instances ([#24](https://github.com/awdr74100/figwright/pull/24))
- Surface layout grids, dashed strokes & rich-text structure; add set_layout_grids ([#31](https://github.com/awdr74100/figwright/pull/31))
- Surface per-run design-system token bindings on mixed TEXT runs ([#32](https://github.com/awdr74100/figwright/pull/32))
- Add set_text_range — inline rich-text authoring (setRange* writes) ([#33](https://github.com/awdr74100/figwright/pull/33))
- **get_screenshot:** Auto-fit default raster scale & report exported size ([#36](https://github.com/awdr74100/figwright/pull/36))
- **read:** Carry paragraph fields & textAutoResize, refuse unknown get_design_context roots, widen get_node budgets ([#35](https://github.com/awdr74100/figwright/pull/35))
- **set_text_properties:** Write paragraphSpacing / paragraphIndent ([#38](https://github.com/awdr74100/figwright/pull/38))
- **read:** Surface Variable.codeSyntax on resolved tokens & variable defs ([#39](https://github.com/awdr74100/figwright/pull/39))
- **set_variable_code_syntax:** Declare a variable's code-side token name ([#40](https://github.com/awdr74100/figwright/pull/40))
- **token_map:** Surface per-theme values for multi-mode variable collections ([#42](https://github.com/awdr74100/figwright/pull/42))
- **design_diff:** Report per-node design changes against a saved baseline ([#43](https://github.com/awdr74100/figwright/pull/43))
- **component-property:** Author boolean/text/instance-swap component properties ([#44](https://github.com/awdr74100/figwright/pull/44))
- **layout:** Read and author min/max size bounds (minWidth/maxWidth/minHeight/maxHeight) ([#51](https://github.com/awdr74100/figwright/pull/51))
- **set_auto_layout:** Author the wrap cross-axis (counterAxisSpacing / counterAxisAlignContent) ([#52](https://github.com/awdr74100/figwright/pull/52))
- **save_image_fills:** Extract original image-fill bytes to disk ([#54](https://github.com/awdr74100/figwright/pull/54))
- **get_design_context:** Node-count bail, payload-size net, and below-full note on the public path ([#58](https://github.com/awdr74100/figwright/pull/58))
- **get_design_context:** Default to the full codegen view with graceful degradation ([#59](https://github.com/awdr74100/figwright/pull/59))
- **get_design_context:** Annotate raw colors with the project's design tokens (value-reverse join) ([#60](https://github.com/awdr74100/figwright/pull/60))
- **token_map:** Join a document's shared paint styles as design tokens ([#61](https://github.com/awdr74100/figwright/pull/61))
- **get_design_context:** Surface aspect-ratio, sticky, stacking, image filters & Dev Mode annotations ([#62](https://github.com/awdr74100/figwright/pull/62))
- **component_map,token_map:** Mapping write-back loop + stale-override degradation ([#64](https://github.com/awdr74100/figwright/pull/64))
- **component_map,profile:** Flag near-tie component picks + first-class Solid ([#65](https://github.com/awdr74100/figwright/pull/65))
- **component_map,profile:** First-class Angular framework support ([#66](https://github.com/awdr74100/figwright/pull/66))
- **styles:** Update_text_style + update_effect_style (write-side parity) ([#67](https://github.com/awdr74100/figwright/pull/67))

### 🩹 Fixes

- **server:** Self-terminate on stdin EOF to prevent zombie leaders ([#22](https://github.com/awdr74100/figwright/pull/22))
- **plugin:** Connect promptly when the plugin is opened before the MCP server ([#28](https://github.com/awdr74100/figwright/pull/28))
- **election:** Don't attach as a follower of a non-Figwright process on :3055 ([#29](https://github.com/awdr74100/figwright/pull/29))
- Strip stray NUL byte in set-text-range, tidy types & dedupe binding logic ([#34](https://github.com/awdr74100/figwright/pull/34))
- **batch:** Snapshot every field a write mutates so rollback is all-or-nothing ([#45](https://github.com/awdr74100/figwright/pull/45))
- **mcp:** Derive destructiveHint from tool specs, not a hand-kept list ([#46](https://github.com/awdr74100/figwright/pull/46))
- **mcp:** Normalize pasted Figma URLs on every canvas-id argument ([#47](https://github.com/awdr74100/figwright/pull/47))
- **token_map:** Disambiguate color value-matches shared by several project tokens ([#56](https://github.com/awdr74100/figwright/pull/56))
- **prompts:** Sync the distilled prompts with current tools and guard tool names ([#57](https://github.com/awdr74100/figwright/pull/57))

### 💅 Refactors

- **repo-walk:** Replace experimental node:fs glob with fdir ([#55](https://github.com/awdr74100/figwright/pull/55))

### 📖 Documentation

- **agents:** Add Engineering standard — equal-or-better bar, root-cause depth, no gold-plating ([#15](https://github.com/awdr74100/figwright/pull/15))
- **tools:** Enrich low-scoring tool descriptions for Glama TDQS ([#16](https://github.com/awdr74100/figwright/pull/16))
- **readme:** Collapse duplicated dev section into a CONTRIBUTING pointer ([#17](https://github.com/awdr74100/figwright/pull/17))
- **readme:** Add bidirectional demo GIFs and a plugin tour ([#18](https://github.com/awdr74100/figwright/pull/18))
- **readme:** Clarify -32000 / Connection closed in the startup FAQ ([#27](https://github.com/awdr74100/figwright/pull/27))
- **tools:** Truthful, steering descriptions for the hot read tools ([#37](https://github.com/awdr74100/figwright/pull/37))
- Sync npm README tool count with the registry and fix stale manifest reasoning ([#49](https://github.com/awdr74100/figwright/pull/49))
- Reword server description and add Codex to client mentions ([#68](https://github.com/awdr74100/figwright/pull/68))

### 🏡 Chore

- Skip changelogen GitHub release prompt in pnpm release ([#13](https://github.com/awdr74100/figwright/pull/13))

### ✅ Tests

- **design-context:** Guard every serialized dimension against silent projection drops ([#48](https://github.com/awdr74100/figwright/pull/48))

### 🤖 CI

- Fail lint on warnings and drop stale tooling leftovers ([#50](https://github.com/awdr74100/figwright/pull/50))

### ❤️ Contributors

- Roya ([@awdr74100](https://github.com/awdr74100))

## v0.2.0

[compare changes](https://github.com/awdr74100/figwright/compare/v0.1.0...v0.2.0)

### 🚀 Enhancements

- Add get_component_api and set_instance_properties ([#3](https://github.com/awdr74100/figwright/pull/3))
- Add import_svg to place vector logos and icons from SVG markup ([#4](https://github.com/awdr74100/figwright/pull/4))
- Let create_component componentize an existing node (fromNodeId) ([#5](https://github.com/awdr74100/figwright/pull/5))
- Add set_arc and read ellipse arcData (pie / gauge / ring) ([#6](https://github.com/awdr74100/figwright/pull/6))
- Carry pattern fill tiling geometry for faithful codegen ([#8](https://github.com/awdr74100/figwright/pull/8))
- Make the plugin window resizable with a drag handle ([#9](https://github.com/awdr74100/figwright/pull/9))

### 🩹 Fixes

- **skills:** Drop non-standard min-server-version frontmatter ([10ec3c4](https://github.com/awdr74100/figwright/commit/10ec3c4))
- Report version mismatches clearly and validate the leader ping ([#2](https://github.com/awdr74100/figwright/pull/2))

### 📖 Documentation

- **skills:** Scope install command to the skills/ subpath ([5277f56](https://github.com/awdr74100/figwright/commit/5277f56))
- Rewrite README, add CONTRIBUTING, and polish project metadata ([#1](https://github.com/awdr74100/figwright/pull/1))
- Swap Node badge for Glama MCP server score badge ([#11](https://github.com/awdr74100/figwright/pull/11))
- Add light/dark logo and simplify README header ([#12](https://github.com/awdr74100/figwright/pull/12))

### 🏡 Chore

- Add glama.json for Glama MCP registry listing ([#10](https://github.com/awdr74100/figwright/pull/10))

### ❤️ Contributors

- Roya ([@awdr74100](https://github.com/awdr74100))

## v0.1.0

### 🚀 Enhancements

- **m2:** Write-parity kickoff — idempotency infra + 3 tools ([0eec93a](https://github.com/awdr74100/figwright/commit/0eec93a))
- **m2:** Add set_opacity / set_visible / rename_node / delete_nodes ([4eda9d0](https://github.com/awdr74100/figwright/commit/4eda9d0))
- **m2:** Add create_text/rectangle, set_corner_radius/strokes, move/resize_nodes ([cb2c3b3](https://github.com/awdr74100/figwright/commit/cb2c3b3))
- **m2:** Add set_auto_layout/blend_mode/constraints, rotate/lock/unlock_nodes, clone_node ([9f96d7e](https://github.com/awdr74100/figwright/commit/9f96d7e))
- **m2:** Add 8 style + 6 variable write tools (34/52) ([652e855](https://github.com/awdr74100/figwright/commit/652e855))
- **m2:** Add structural + bulk-text write tools (40/52) ([0d8b7e0](https://github.com/awdr74100/figwright/commit/0d8b7e0))
- **m2:** Add page write tools (44/52) ([4a8d40c](https://github.com/awdr74100/figwright/commit/4a8d40c))
- **m2:** Add prototype + component-nav write tools (48/52) ([5405744](https://github.com/awdr74100/figwright/commit/5405744))
- **m2:** Add import_image write tool (49/52) ([e6e307e](https://github.com/awdr74100/figwright/commit/e6e307e))
- **m2:** Add create_ellipse / create_component / create_section — 52/52 tool count ([bb25810](https://github.com/awdr74100/figwright/commit/bb25810))
- **m2:** Add batch atomic write tool — 53 tools, all-or-nothing rollback ([ba6d4d4](https://github.com/awdr74100/figwright/commit/ba6d4d4))
- **m2:** Add create_instance — fills the component-side planning gap (54 tools) ([45bad2a](https://github.com/awdr74100/figwright/commit/45bad2a))
- **m2.5:** Gradient paints — read + write (round-trippable) ([9341f4a](https://github.com/awdr74100/figwright/commit/9341f4a))
- **m2.5:** Text truncation/maxLines (read+write) + FLOAT alias regression test ([3bed475](https://github.com/awdr74100/figwright/commit/3bed475))
- **design-context:** P1 surface grounding fields ([52c226e](https://github.com/awdr74100/figwright/commit/52c226e))
- **design-context:** P2 resolve token ids to names ([84cd506](https://github.com/awdr74100/figwright/commit/84cd506))
- **design-context:** P3 globalVars dedup + structured values + metrics ([69ccea9](https://github.com/awdr74100/figwright/commit/69ccea9))
- **design-context:** P3.1 surface + dedup strokes & effects ([3583b60](https://github.com/awdr74100/figwright/commit/3583b60))
- **m3:** Analyze_project — JS/TS profile detector (Tailwind v3+v4 aware) ([4a9ce62](https://github.com/awdr74100/figwright/commit/4a9ce62))
- **m3:** Scan_components — oxc-based local component scanner ([a460176](https://github.com/awdr74100/figwright/commit/a460176))
- **m3:** Component_map — join Figma component names to local code components ([be0fb7c](https://github.com/awdr74100/figwright/commit/be0fb7c))
- **m3:** Wire scan_components + component_map; demote analyze_project to internal helper ([7a02671](https://github.com/awdr74100/figwright/commit/7a02671))
- **m3:** Expose analyze_project as a standalone MCP tool (revert demotion) ([b12ec5b](https://github.com/awdr74100/figwright/commit/b12ec5b))
- **m3:** Token_map — join Figma variables to project design tokens ([87ae2f8](https://github.com/awdr74100/figwright/commit/87ae2f8))
- **m3:** Token_map B3 — Tailwind/Figma namespace synonyms ([a58aeda](https://github.com/awdr74100/figwright/commit/a58aeda))
- **m3:** Component_map emits per-instance props (instances[]) ([cdaafc1](https://github.com/awdr74100/figwright/commit/cdaafc1))
- **m3:** Component_map reports unmatchedProps (component-extension TODOs) ([b15fb89](https://github.com/awdr74100/figwright/commit/b15fb89))
- **m3:** Token_map opens size↔text via the variable's collection ([5a437bf](https://github.com/awdr74100/figwright/commit/5a437bf))
- **m3:** MCP prompts capability + figma_to_code (cross-client codegen) ([8de7066](https://github.com/awdr74100/figwright/commit/8de7066))
- **relay:** Multi-plugin routing on most-recently-active session ([1613dad](https://github.com/awdr74100/figwright/commit/1613dad))
- **plugin:** Emit activity on window focus/visibility ([56b8422](https://github.com/awdr74100/figwright/commit/56b8422))
- **codegen:** Asset-export step — close the no-codegen fidelity gap ([2f61138](https://github.com/awdr74100/figwright/commit/2f61138))
- **token_map:** Framework-builtin scale recognition + codegen effect-fidelity guidance ([5ea3d11](https://github.com/awdr74100/figwright/commit/5ea3d11))
- **token_map:** Font-weight framework-builtin (weight/\* → font-bold etc.) ([f8972fd](https://github.com/awdr74100/figwright/commit/f8972fd))
- **get_design_context:** Per-instance textOverrides on deduped instances ([f55d3d1](https://github.com/awdr74100/figwright/commit/f55d3d1))
- **serializer:** Surface per-side stroke weights for mixed borders ([d34a2b6](https://github.com/awdr74100/figwright/commit/d34a2b6))
- **profile:** Svg-handling detection + icon import/use guidance ([838043b](https://github.com/awdr74100/figwright/commit/838043b))
- **scan:** Gitignore-aware shared repo walker ([e47ca2a](https://github.com/awdr74100/figwright/commit/e47ca2a))
- **screenshot:** Flag empty exports (clipped/off-canvas/hidden nodes) ([9301e89](https://github.com/awdr74100/figwright/commit/9301e89))
- **write:** Tier 1 write-surface hardening — typography, per-side strokes, variable CRUD, child layout ([0047d72](https://github.com/awdr74100/figwright/commit/0047d72))
- **write:** Add combine_as_variants — combine COMPONENTs into a COMPONENT_SET ([07aa2bb](https://github.com/awdr74100/figwright/commit/07aa2bb))
- **codegen:** Gradient + image object-fit fidelity (close two silent grounding misses) ([0b9fae7](https://github.com/awdr74100/figwright/commit/0b9fae7))
- **codegen:** StrokeAlign semantics (close the application-side miss behind Framelink #386) ([893ac03](https://github.com/awdr74100/figwright/commit/893ac03))
- **grounding:** Surface auto-layout to get_design_context + GRID auto-layout (read+write) ([fcb4028](https://github.com/awdr74100/figwright/commit/fcb4028))
- **plugin-ui:** Slim the panel, add "Run in background", fix Context overflow ([0bc5c1d](https://github.com/awdr74100/figwright/commit/0bc5c1d))
- **grounding:** Icon_map — reuse curated .svg icons + color contract ([28405b2](https://github.com/awdr74100/figwright/commit/28405b2))
- **grounding:** Get_variable_defs emits hex for COLOR values ([30a0aec](https://github.com/awdr74100/figwright/commit/30a0aec))
- **grounding:** Surface per-corner radius, blendMode, mask in read path ([cf8f07d](https://github.com/awdr74100/figwright/commit/cf8f07d))
- **write:** Per-corner set_corner_radius + new set_mask tool ([7437460](https://github.com/awdr74100/figwright/commit/7437460))
- Derive displayed versions from the single product version ([ee176fa](https://github.com/awdr74100/figwright/commit/ee176fa))
- **mcp:** Accept a Figma URL or dash-form node id in id args ([e18cb14](https://github.com/awdr74100/figwright/commit/e18cb14))
- **mcp:** Bind a color variable to a fill/stroke paint ([dfd740b](https://github.com/awdr74100/figwright/commit/dfd740b))
- **skill:** Add figma-build skill + code_to_figma prompt (write direction) ([01e5d11](https://github.com/awdr74100/figwright/commit/01e5d11))
- **mcp:** Delete a variable collection by id ([ac5d532](https://github.com/awdr74100/figwright/commit/ac5d532))
- **plugin:** Show the payload fed to the LLM in the Activity tab ([12f6734](https://github.com/awdr74100/figwright/commit/12f6734))
- **plugin:** Tidy payload row + use vueuse clipboard ([53d44ba](https://github.com/awdr74100/figwright/commit/53d44ba))
- **plugin:** Copyable diagnostic bundle for bug reports ([efc87a5](https://github.com/awdr74100/figwright/commit/efc87a5))
- **mcp:** Export a node or page to a single PDF file ([4edac47](https://github.com/awdr74100/figwright/commit/4edac47))
- **get_design_context:** Warn on multi-breakpoint selection to keep mixed codegen grounded ([adf2505](https://github.com/awdr74100/figwright/commit/adf2505))
- Keep the connection alive through heavy operations (busy ≠ dead) ([7ee504d](https://github.com/awdr74100/figwright/commit/7ee504d))
- **get_design_context:** Surface text typography so codegen stops eyeballing it ([a0952ec](https://github.com/awdr74100/figwright/commit/a0952ec))

### 🔥 Performance

- **component-map:** Resolve set name from grounding, drop doc-wide scan ([0640441](https://github.com/awdr74100/figwright/commit/0640441))
- **scan:** Prune ignored dirs at the glob level, not after ([d42264b](https://github.com/awdr74100/figwright/commit/d42264b))
- **plugin:** Skip full serialization for minimal/compact get_design_context ([1d8f623](https://github.com/awdr74100/figwright/commit/1d8f623))

### 🩹 Fixes

- **m2:** Set_variable_value — type the polymorphic `value` so it isn't stringified ([55a9ea4](https://github.com/awdr74100/figwright/commit/55a9ea4))
- **design-context:** Emit node style refs before children ([1025117](https://github.com/awdr74100/figwright/commit/1025117))
- **hook:** Scope format-on-edit to files inside the project root ([1ac4f7f](https://github.com/awdr74100/figwright/commit/1ac4f7f))
- **m3:** A/B-driven accuracy fixes for component_map + token_map ([3440cac](https://github.com/awdr74100/figwright/commit/3440cac))
- **component-map:** Degrade gracefully when get_local_components times out ([84ab5fa](https://github.com/awdr74100/figwright/commit/84ab5fa))
- **relay:** Session affinity for multi-call tools ([9b0042b](https://github.com/awdr74100/figwright/commit/9b0042b))
- **component-map:** Merge a component across sibling frames into one usage ([96c6d30](https://github.com/awdr74100/figwright/commit/96c6d30))
- **routing:** Visibility-gated activity + no-selection scope guards ([af164f7](https://github.com/awdr74100/figwright/commit/af164f7))
- **scan:** Single-extension profiles (Vue/Svelte) silently scanned nothing ([0070a84](https://github.com/awdr74100/figwright/commit/0070a84))
- **routing:** A reconnect must not steal routing from the active file ([eab1c42](https://github.com/awdr74100/figwright/commit/eab1c42))
- **token_map:** Emit var() ref on non-Tailwind projects, not a bogus utility ([300efb7](https://github.com/awdr74100/figwright/commit/300efb7))
- **variables:** Parse stringified VARIABLE_ALIAS for FLOAT vars (go #22 last edge) ([92de535](https://github.com/awdr74100/figwright/commit/92de535))
- **mcp:** Move @figwright/shared to devDependencies ([e731482](https://github.com/awdr74100/figwright/commit/e731482))
- **plugin:** Auto-reconnect when plugin opens before the relay server ([fa8ac9a](https://github.com/awdr74100/figwright/commit/fa8ac9a))
- **plugin:** Recover clipped/off-canvas exports via useAbsoluteBounds ([24dc2d6](https://github.com/awdr74100/figwright/commit/24dc2d6))

### 💅 Refactors

- **m2:** Registry guards + honest batch rollback (post-M2 retrospective) ([44cf086](https://github.com/awdr74100/figwright/commit/44cf086))
- **server:** Tool-spec helper + first reads to Zod (Phase 1) ([766c6ff](https://github.com/awdr74100/figwright/commit/766c6ff))
- **server:** Convert simple read tools to Zod specs (Phase 1) ([f33a056](https://github.com/awdr74100/figwright/commit/f33a056))
- **server:** Convert remaining read tools to Zod specs (Phase 1) ([b561c1b](https://github.com/awdr74100/figwright/commit/b561c1b))
- **server:** Convert server-local tools to Zod specs (Phase 1) ([7c21003](https://github.com/awdr74100/figwright/commit/7c21003))
- **server:** Convert all write tools to Zod specs (Phase 1 complete) ([c4acdba](https://github.com/awdr74100/figwright/commit/c4acdba))
- **server:** Cut over to McpServer (registerTool/registerPrompt) ([72824a7](https://github.com/awdr74100/figwright/commit/72824a7))
- **server:** Move schema-derivation helper out of src to test-only ([f211529](https://github.com/awdr74100/figwright/commit/f211529))
- Convert shared + plugin + election layer to Zod ([387015e](https://github.com/awdr74100/figwright/commit/387015e))
- **m3:** Hardening review — SFC props, CSS-var token grounding, cleanup ([ffd44aa](https://github.com/awdr74100/figwright/commit/ffd44aa))
- **plugin-ui:** Adopt vueuse composables in App.vue ([83a2531](https://github.com/awdr74100/figwright/commit/83a2531))
- **repo:** Rename packages/server → packages/mcp ([6e31a91](https://github.com/awdr74100/figwright/commit/6e31a91))
- Move skills to repo root for skills.sh discovery ([3f28078](https://github.com/awdr74100/figwright/commit/3f28078))
- **skill:** Split figma-codegen into a router + references ([3587be3](https://github.com/awdr74100/figwright/commit/3587be3))
- **skill:** Split figma-build into a router + references ([7770218](https://github.com/awdr74100/figwright/commit/7770218))

### 📖 Documentation

- **plan:** Record Framelink borrowed techniques for M3 ([1f49745](https://github.com/awdr74100/figwright/commit/1f49745))
- **skills:** Rewrite figma-codegen to orchestrate the shipped M3 tools ([f12b502](https://github.com/awdr74100/figwright/commit/f12b502))
- **skills:** Figma-codegen drills repeated unmapped components ([eaba36c](https://github.com/awdr74100/figwright/commit/eaba36c))
- **server:** Correct spec bridge comments + record McpServer migration done ([e590564](https://github.com/awdr74100/figwright/commit/e590564))
- **codegen:** Tell codegen to read deduped instances' textOverrides ([faf4cdc](https://github.com/awdr74100/figwright/commit/faf4cdc))
- **codegen:** Responsive-by-default + breakpoint-discovery guidance ([316266d](https://github.com/awdr74100/figwright/commit/316266d))
- **codegen:** Full-bleed pages need a body reset — conditionally ([6f3b313](https://github.com/awdr74100/figwright/commit/6f3b313))
- **codegen:** The conditional reset must be complete, not body-only ([54a3bb9](https://github.com/awdr74100/figwright/commit/54a3bb9))
- **plan:** M5 re-evaluation — converge visual verification to skill self-verify, cut 2 screenshot tools ([388d8e3](https://github.com/awdr74100/figwright/commit/388d8e3))
- **codegen:** Large-design section-by-section + ground-every-section guidance ([82adee5](https://github.com/awdr74100/figwright/commit/82adee5))
- Add AGENTS.md (project guide) + CLAUDE.md pointer ([87cebf2](https://github.com/awdr74100/figwright/commit/87cebf2))
- **skill:** Broaden figma-codegen trigger description ([8540a27](https://github.com/awdr74100/figwright/commit/8540a27))
- **skill:** Note delete_variable_collection in author-design-system ([538ce08](https://github.com/awdr74100/figwright/commit/538ce08))
- **skill:** Prefer min-w over hard width for fixed-width hug controls ([a3134eb](https://github.com/awdr74100/figwright/commit/a3134eb))
- **skill:** Treat a same-size sibling artboard as an overlay state, not a fixed-width sidebar ([c06c222](https://github.com/awdr74100/figwright/commit/c06c222))
- **skill:** Ground each breakpoint's own values for mixed desktop/mobile selection ([0b3f9d5](https://github.com/awdr74100/figwright/commit/0b3f9d5))
- **mcp:** Note cornerRadius binds all four corners in bind_variable_to_node ([0335503](https://github.com/awdr74100/figwright/commit/0335503))
- Use 2026-present in license copyright ([c04a902](https://github.com/awdr74100/figwright/commit/c04a902))
- **figma-codegen:** Translate absolute positioning + constraints in grounding ([1d9ee11](https://github.com/awdr74100/figwright/commit/1d9ee11))

### 🏡 Chore

- Pin all `latest` dependency specifiers to caret ranges ([7976012](https://github.com/awdr74100/figwright/commit/7976012))
- Align @types/node to the Node 24 major (^24.12.4) ([557dd83](https://github.com/awdr74100/figwright/commit/557dd83))
- Auto-format/lint edited files via PostToolUse hook ([9e88144](https://github.com/awdr74100/figwright/commit/9e88144))
- Move format-on-edit hook script under .claude/hooks/ ([ddf2c4c](https://github.com/awdr74100/figwright/commit/ddf2c4c))
- **server:** Add zod dep for McpServer migration (Phase 0) ([66ef4df](https://github.com/awdr74100/figwright/commit/66ef4df))
- Remove routing/timeout debug instrumentation ([c78e939](https://github.com/awdr74100/figwright/commit/c78e939))
- **format:** Bump oxfmt 0.51→0.53 and reformat the tree ([197f52d](https://github.com/awdr74100/figwright/commit/197f52d))
- Stop tracking PLAN.md (internal dev doc, not for publication) ([ce9bff8](https://github.com/awdr74100/figwright/commit/ce9bff8))
- **skills:** Vendor skill-creator under .claude/skills ([eeeb502](https://github.com/awdr74100/figwright/commit/eeeb502))
- **skills:** Vendor create-readme skill under .claude/skills ([b501f52](https://github.com/awdr74100/figwright/commit/b501f52))
- **rename:** Figma-mcp-relay → figwright ([cead534](https://github.com/awdr74100/figwright/commit/cead534))
- **rename:** Point .mcp.json at ~/Desktop/figwright ([2c366a9](https://github.com/awdr74100/figwright/commit/2c366a9))
- **rename:** Plugin UI color tokens relay-_ → fig-_ ([4618dd9](https://github.com/awdr74100/figwright/commit/4618dd9))
- **mcp:** Use repo-relative path in .mcp.json ([262af53](https://github.com/awdr74100/figwright/commit/262af53))
- **knip:** Make knip pass so it can gate CI ([0a158ac](https://github.com/awdr74100/figwright/commit/0a158ac))
- **knip:** Drop redundant config flagged by knip's own hints ([7e93814](https://github.com/awdr74100/figwright/commit/7e93814))
- **lint:** Clear the remaining oxlint warnings ([0ceda52](https://github.com/awdr74100/figwright/commit/0ceda52))
- Tidy local-only files into .local/ ([bcd1139](https://github.com/awdr74100/figwright/commit/bcd1139))
- Set author/copyright to Roya ([395f7e8](https://github.com/awdr74100/figwright/commit/395f7e8))
- Remove lefthook git hooks ([3be457d](https://github.com/awdr74100/figwright/commit/3be457d))
- Upgrade dev dependencies and quiet new oxlint warning ([69f7323](https://github.com/awdr74100/figwright/commit/69f7323))
- **skills:** Mirror skills/ into .claude/skills via postinstall instead of symlinks ([11e6ca0](https://github.com/awdr74100/figwright/commit/11e6ca0))
- Upgrade pnpm to 11.8.0 and node to 24.17.0 ([e4cc32c](https://github.com/awdr74100/figwright/commit/e4cc32c))
- **vscode:** Run oxc format and fixAll on save ([7387524](https://github.com/awdr74100/figwright/commit/7387524))

### 🎨 Styles

- Format sync-skills.mjs with oxfmt ([62cf9e8](https://github.com/awdr74100/figwright/commit/62cf9e8))

### 🤖 CI

- Add CI workflow (typecheck, lint, knip, build, test) ([fda58c5](https://github.com/awdr74100/figwright/commit/fda58c5))
- Validate PR titles follow Conventional Commits ([99a546c](https://github.com/awdr74100/figwright/commit/99a546c))
- Add format:check gate; ignore vendored skills in oxfmt config ([9c9070a](https://github.com/awdr74100/figwright/commit/9c9070a))
- Add release pipeline (changelogen + OIDC npm publish) ([ba3985f](https://github.com/awdr74100/figwright/commit/ba3985f))
- Product-level CHANGELOG at root + ship the Figma plugin as a release asset ([94a905a](https://github.com/awdr74100/figwright/commit/94a905a))
- Validate publish correctness with publint (via tsdown) ([8836af5](https://github.com/awdr74100/figwright/commit/8836af5))

### ❤️ Contributors

- Roya <a78945612385238@gmail.com>
