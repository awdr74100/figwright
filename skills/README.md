# Figwright skills

Agent skills that orchestrate Figwright's MCP tools. They are model-invoked: your agent loads one
automatically when the task matches the skill's `description`.

| Skill                                       | What it does                                                                                                      |
| :------------------------------------------ | :---------------------------------------------------------------------------------------------------------------- |
| [`figma-codegen`](./figma-codegen/SKILL.md) | Turn a Figma selection into framework-aware code, grounded on the project's stack and existing components/tokens. |

## Install

Install across any supported agent (Claude Code, Cursor, Codex, Copilot, Windsurf, Gemini, …) with the
[`skills`](https://www.skills.sh) CLI — it pulls straight from this repo, no upload or registration:

```bash
# all skills in this repo
npx skills add awdr74100/figwright

# or a single skill
npx skills add https://github.com/awdr74100/figwright/tree/main/skills/figma-codegen
```

> **The skills need the `@figwright/mcp` server.** They call Figwright tools (`get_design_context`,
> `component_map`, …), so install and connect the [MCP server](../packages/mcp) first — a skill on its
> own has no tools to drive.
