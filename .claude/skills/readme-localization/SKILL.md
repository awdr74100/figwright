---
name: readme-localization
description: Keep Figwright's Traditional Chinese and Simplified Chinese READMEs aligned with the English root README. Use when editing user-facing content in root README.md, synchronizing translations after an English README change, or reviewing either Chinese README for accuracy and local usage. Covers professional technical writing for Taiwan and mainland China, not character conversion or unrelated documentation translation.
---

# README localization

Maintain `README.zh-TW.md` and `README.zh-CN.md` against the English `README.md` at the
repository root. English remains the default entry point and the source of product facts;
each Chinese edition must read as a professional technical document written for its audience.
This is a repository-maintenance skill. It needs no Figma connection or MCP tools.

## Establish what changed

Read the three READMEs and inspect their working-tree and staged diffs before editing.
Preserve existing contributor edits. Use the source revision or commit range supplied with
the task to identify changes; do not assume `HEAD` is the last translated revision. When no
reliable baseline exists, compare the current English document with both translations
section by section, including collapsed FAQs, captions, image descriptions, and diagrams.

Account for additions, changes, removals, and moved sections in both editions. Update only
the affected passages and any surrounding wording needed for coherence; retain accurate
translations and previous editorial improvements. An English-only wording change may need
no translation change if both editions already express its meaning. Report that outcome
instead of making cosmetic edits to demonstrate activity.

For a review-only request, report discrepancies without editing. If the user explicitly
limits an edit to English, respect that scope and identify the translations still needing
an update.

## Localize meaning and register

Compose each edition from the English meaning and its existing local terminology.
Traditional-to-Simplified character conversion is not a localization workflow. Use Taiwan
technical usage for `zh-TW` and mainland China technical usage for `zh-CN`.

Write complete, direct sentences with explicit conditions and consequences. Keep a
professional register: neither conversational instructions nor bureaucratic wording.
Restructure English sentences when necessary; preserve the technical claim, not English
word order, idioms, or metaphors. For example, use「使用範例」/「使用示例」rather than
「試著下個指令」/「试着下个指令」for an examples heading.

Use this vocabulary as a contextual guide, not a global replacement table:

| Meaning                    | Traditional Chinese (Taiwan) | Simplified Chinese (mainland China) |
| -------------------------- | ---------------------------- | ----------------------------------- |
| server / client            | 伺服器 / 用戶端              | 服务器 / 客户端                     |
| plugin / component         | 外掛 / 元件                  | 插件 / 组件                         |
| code / project             | 程式碼 / 專案                | 代码 / 项目                         |
| package / dependency       | 套件 / 相依套件              | 软件包 / 依赖                       |
| configuration / default    | 設定 / 預設                  | 配置 / 默认                         |
| process / terminal         | 程序 / 終端機                | 进程 / 终端                         |
| file / data / information  | 檔案 / 資料 / 資訊           | 文件 / 数据 / 信息                  |
| tab / background execution | 分頁 / 背景執行              | 标签页 / 后台运行                   |
| paid plan / seat           | 付費方案 / 席次              | 付费套餐 / 席位                     |
| claim a Figma file         | 綁定 Figma 檔案              | 绑定 Figma 文件                     |

Retain established English technical terms where clearer, defining them locally when
needed. Existing intentional forms such as `MCP client` need not be replaced throughout
an otherwise unchanged edition. Interpret domain terms: a file claim is a routing binding,
not ownership or an exclusive lock; grounding means using actual design and project
information, not a literal translation of “ground.” Distinguish framework from Figma frame.

After translating, read each changed passage without looking at the English. Correct
unnatural phrasing and inconsistent terminology, then compare it with the source again
to confirm that fluency edits have not changed its meaning.

## Preserve the technical contract

- Preserve prerequisites, version ranges, limitations, quantities, negations, and the
  distinction between required and optional steps. Do not strengthen a conditional claim
  into a guarantee or omit an exception to make a sentence shorter.
- Keep executable commands, JSON keys and values, API/tool names, paths, and identifiers
  unchanged. Translate explanatory comments and natural-language example prompts when
  useful; retain example values referenced by commands so the examples remain coherent.
- Keep actual UI labels, such as **Run in background**, identifiable in English; add a
  Chinese explanation when needed rather than inventing a translated interface label.
- Translate captions, meaningful image alternative text, and diagram explanations. Reuse
  the existing images and preserve the diagram's relationships and readable alignment.
- Preserve the three-way language navigation, the active-language indication, and the
  English-source notice. Keep relative links and explicit section anchors functional
  after moving or renaming headings. Use links between editions, not scripted tabs.
- If the English source appears ambiguous, contradictory, or outdated, identify the
  exact passage and supporting evidence. Do not silently correct the product facts in
  Chinese alone. Continue independent updates and report the unresolved passage; when
  correcting the source is within the task's scope, apply the verified correction to all
  three editions together.

## Verify and report

Before completing the task, account for every affected source passage in both editions.
Compare code examples and technical literals with English, resolve local links and image
paths, and check navigation targets and balanced code fences and `details` elements.
Use the repository's configured formatter and follow its applicable contribution checks.

For changes to navigation or Markdown/HTML structure, inspect rendered output and exercise
the affected language links, section links, and FAQ disclosures. Inspect desktop and narrow
layouts when wrapping or diagram layout changes. Distinguish a local preview from GitHub's
published rendering; if rendering could not be checked, report that limitation.

Report the sections synchronized, locale-specific terminology decisions that matter, checks
actually run, and any unresolved source questions or deferred translations. Structural
checks do not prove linguistic quality, and a self-review is not independent native-speaker
review. Leave commits, pushes, and pull requests to the user's explicit authorization.
