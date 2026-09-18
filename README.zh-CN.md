<div align="center">

<br />

<picture><source media="(prefers-color-scheme: dark)" srcset="./.github/assets/logo-full-dark.svg"><source media="(prefers-color-scheme: light)" srcset="./.github/assets/logo-full-light.svg"><img alt="Figwright" src="./.github/assets/logo-full-light.svg" width="499" height="150"></picture>

<br />

<p align="center">
  面向 AI 编程代理的免费双向 Figma MCP 服务器。
  <br />
  搭配 Figma 插件即可使用，无需 Dev Mode 席位。
</p>

[English](./README.md) · [繁體中文](./README.zh-TW.md) · **简体中文**

[关于](#about) · [安装配置](#setup) · [Skills](#skills) · [工具](#tools) · [插件](#plugin) · [常见问题](#faq) · [参与贡献](#contributing)

[![npm](https://img.shields.io/npm/v/@figwright/mcp?logo=npm&color=cb3837)](https://www.npmjs.com/package/@figwright/mcp)
[![CI](https://github.com/awdr74100/figwright/actions/workflows/ci.yml/badge.svg)](https://github.com/awdr74100/figwright/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

<a href="https://trendshift.io/repositories/68274?utm_source=trendshift-badge&amp;utm_medium=badge&amp;utm_campaign=badge-trendshift-68274" target="_blank" rel="noopener noreferrer"><img alt="Figwright on Trendshift" src="https://trendshift.io/api/badge/trendshift/repositories/68274/daily?language=TypeScript" width="250" height="55"></a>

</div>

本页为简体中文版；内容如有差异，请以 [English README](./README.md) 为准。

<a name="about"></a>

## 关于 Figwright

Figwright 通过本地 WebSocket 中继服务，连接 **MCP 服务器**与 **Figma 插件**，让 AI 代理（Claude Code、Cursor、Codex 或其他 MCP 客户端）能直接操作 Figma，而不只是读取设计。

它支持两个方向的工作流：

**读取设计**：获取准确反映原稿、已去除重复内容的设计上下文（布局、文字排版、变量和组件），将 Figma 中选中的内容转成符合项目框架的代码。

<p align="center">
  <img alt="Figwright 将 Figma 选中内容转成代码" src="./.github/assets/figma-to-code.gif" width="820">
</p>

**编辑设计**：直接在画布上创建和修改内容，从画框（frame）、文本、自动布局（auto-layout）、样式、变量、组件，到整个页面都能处理。

<p align="center">
  <img alt="Figwright 直接在 Figma 画布上创建设计" src="./.github/assets/code-to-figma.gif" width="820">
</p>

Figwright 的服务器、中继服务和插件都在你的电脑上运行，没有 Figwright 云服务。设计数据会交给 MCP 客户端；客户端是否将数据发送给模型提供商，取决于你的配置。

<a name="why-figwright"></a>

## 为什么选择 Figwright

- **支持免费套餐**：Figwright 使用 Figma 免费套餐即可运行，无需付费的 Dev Mode 席位。官方 Figma MCP 则有[因套餐和席位而异的访问权限及用量限制](https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/)，免费套餐也有有限额度。
- **双向操作**：**113 个工具**覆盖画布的读取与编辑，让代理既能根据设计编写代码，也能直接创建设计。
- **根据项目生成代码**：采用 provider-first 的设计理念，检测项目实际使用的框架和样式方案，并复用现有组件、设计 token 和图标，减少重新调整通用代码的工作。
- **每个代理独立绑定文件**：多个代理可以同时工作，各自绑定已打开的 Figma 文件。切换标签页时，不会把某个代理的修改写入另一份设计；详见[常见问题](#faq)中的多文件操作说明。
- **开放且可扩展**：读取与编辑工作流均以可安装的 [skills](#skills) 提供，你可以直接使用，也可以 fork 后自行调整。

<a name="setup"></a>

## 安装配置

你需要 **MCP 客户端**（Claude Code、Cursor 等）、**Node.js 20.19+ 或 22.12+**，以及 **Figma**。使用 Figma 免费套餐即可，但导入插件时需要桌面版。服务器由 `npx` 启动为独立进程，因此它使用的 Node 版本可以与项目构建所用的版本不同；不支持 Node 18、21 和 22.0–22.11。

### 1. 将服务器添加到 MCP 客户端

以 Claude Code 为例，将以下配置添加到 `.mcp.json`。其他客户端请按各自的 MCP 配置格式，填写相同的启动命令和参数：

```json
{
  "mcpServers": {
    "figwright": {
      "command": "npx",
      "args": ["-y", "@figwright/mcp@latest"]
    }
  }
}
```

`npx` 会下载并运行已发布的服务器软件包，无需全局安装。

### 2. 安装 Figma 插件

插件尚未上架 Figma Community，请从最新版本下载安装：

1. 前往 [**GitHub 最新版本**](https://github.com/awdr74100/figwright/releases/latest)，下载插件 zip 并解压。
2. 在 Figma **桌面版**中依次选择 **Menu → Plugins → Development → Import plugin from manifest…**，然后选择解压后的 `manifest.json`。

### 3. 建立连接

在 Figma 中打开 Figwright 插件（**Plugins → Development → Figwright**）。它会自动连接本地服务器，并显示 **Connected**。让代理执行 `ping`，确认连接正常。

### 4. 安装 skills（可选）

[Skills](#skills) 会引导代理在合适的任务中使用 Figwright，并根据实际设计与项目信息完成工作：

```bash
npx skills add awdr74100/figwright/skills
```

### 5. 使用示例

在 Figma 中选中一个画框，并向代理提供以下指令：

> _将 Figma 当前选中的内容实现为 React 组件。_

也可以反过来，让代理创建设计：

> _根据这份需求说明，在 Figma 中创建一个套餐定价区块。_

<a name="skills"></a>

## Skills

Agent skills 负责组织 Figwright 的工具和工作流。当任务符合某个 skill 的描述时，代理会自动加载，无需手动调用。

| Skill                                              | 功能                                                              |
| :------------------------------------------------- | :---------------------------------------------------------------- |
| [`figma‑codegen`](./skills/figma-codegen/SKILL.md) | 根据项目的技术栈和现有组件，将 Figma 选中内容转成符合框架的代码。 |
| [`figma‑build`](./skills/figma-build/SKILL.md)     | 根据代码或文字描述创建 Figma 设计，并复用文件中的现有组件和样式。 |

通过 [`skills`](https://www.skills.sh) CLI，可安装到任何受支持的代理：

```bash
npx skills add awdr74100/figwright/skills      # 安装两个 skills
npx skills add https://github.com/awdr74100/figwright/tree/main/skills/figma-codegen  # 只安装一个
```

> [!NOTE]
> Skills 需要已连接的 `@figwright/mcp` 服务器才能工作；只安装 skills 并不会提供可调用的工具。

<a name="tools"></a>

## 工具

Figwright 提供 **113 个 MCP 工具**，分为三类：

- **读取**：查看选中内容、文档、节点、样式、变量、组件、字体、交互设置（reactions）和 Motion 动画状态；截图、获取图片填充的原始素材、导出 PDF，以及将动画画框导出为视频（MP4／GIF／WebM）。另外还提供 `list_files`／`use_file`，用于同时处理多份已打开的 Figma 文件。
- **编辑**：创建和修改画框、文本、形状、自动布局、效果、样式、变量、组件（包括布尔、文本和实例替换属性）、页面、交互设置，以及 Motion 动画（关键帧、动画样式预设和时间轴）。也可以使用 `batch` 批量应用多项修改。
- **设计与代码对照（Grounding）**：`get_design_context` 提供准确反映原稿且已去除重复内容的设计上下文；`component_map`／`token_map`／`icon_map` 将 Figma 数据映射到项目代码，让生成的代码复用现有实现。`design_diff` 则会对照已保存的基准，列出设计变更，让你只需更新受影响的代码。

> [!TIP]
> MCP 客户端会在连接时列出所有工具；请以这份列表为准，它反映的是当前服务器实际提供的工具。

<a name="plugin"></a>

## 插件

Figma 插件会展示完整的运行信息：每次工具调用都会实时显示，你可以查看实际传给模型的数据，也能了解连接状况。

<p align="center">
  <img alt="Figwright 面板：工具调用记录、展开后的模型接收数据，以及显示连接和调用统计的 Debug 标签页" src="./.github/assets/plugin-panel.png" width="820">
</p>

<p align="center">
  <sub><b>Activity</b>：每次调用的记录、耗时，以及跳转到相关节点的入口 · <b>Payload</b>：模型实际收到的数据 · <b>Debug</b>：连接状况、版本信息与一键导出诊断数据</sub>
</p>

插件也会随 Figma 切换浅色或深色主题。

<p align="center">
  <img alt="同一个面板在 Figma 浅色和深色主题下的外观" src="./.github/assets/plugin-theme.png" width="616">
</p>

拖动面板右下角即可调整大小；增加高度可显示更多记录，设置的尺寸会在下次打开时保留。如需隐藏面板，请点击标题栏中、Figma ✕ 按钮下方的 **Run in background**。隐藏后仍会保持连接，代理可继续执行长时间任务；再次运行插件即可重新显示面板。上方的 ✕ 则会关闭插件，同时断开连接。

<p align="center">
  <img alt="两种面板尺寸：窄面板显示三条调用与缩放角落，宽面板显示五条调用与标题栏的后台运行按钮" src="./.github/assets/plugin-window.png" width="602">
</p>

<p align="center">
  <sub><b>调整大小</b>：拖动角落，尺寸会自动保留 · <b>后台运行</b>：隐藏面板，中继连接不中断</sub>
</p>

<a name="how-it-works"></a>

## 工作原理

MCP 客户端通过 stdio 与 `@figwright/mcp` 服务器通信，服务器再经由本地 WebSocket 将请求转发给 Figma 插件。多个客户端可以共用同一个插件，由选举机制决定哪个服务器负责连接；传输层也具备断线后的恢复机制：

```text
┌─────────────────────────────────────────────────────────────────────┐
│ MCP CLIENTS · 每个代理各有一个客户端                                │
│ Claude Code · Cursor · Claude · 其他支持 MCP 的客户端               │
└─────────────────────────────────────────────────────────────────────┘
                                   │  通过 stdio 传输 MCP 消息
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│ @figwright/mcp · 每个客户端启动一个，并选出 leader                  │
│                                                                     │
│ LEADER（负责维持插件连接）                                          │
│    • WebSocket 中继 · 请求幂等性                                    │
│    • 将请求路由至最近操作的文件                                     │
│    • 会话恢复 · 心跳机制区分忙碌与失联                              │
│    • 端点：/ws（插件）· /ping（健康检查）· /rpc（followers）        │
│                                                                     │
│ FOLLOWERS                                                           │
│    • 通过 HTTP /rpc 将工具调用转发给 leader                         │
│    • leader 退出时自动接管                                          │
└─────────────────────────────────────────────────────────────────────┘
                                   │  本地 WebSocket · msgpack（二进制）
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│ FIGMA（桌面版或浏览器）                                             │
│                                                                     │
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │ Figwright 插件                                                  │ │
│ │   • UI（Vue 3 iframe）：WebSocket 客户端与心跳                  │ │
│ │   • sandbox：执行 Figma Plugin API 调用                         │ │
│ └─────────────────────────────────────────────────────────────────┘ │
│                                                                     │
│              │ Figma Plugin API                                     │
│              ▼                                                      │
│            画布                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

图中的 LEADER 是负责插件连接的主服务器，FOLLOWERS 是转发调用的其他服务器。UI 在 iframe 中维持 WebSocket 与心跳；sandbox 负责调用 Figma Plugin API，操作画布。

Figwright 采用 **provider-first** 的设计理念：工具负责提供准确的设计上下文，再由模型生成符合你的项目的代码，而不是套用固定的编译流程。[`figma-codegen`](#skills) skill 将这套做法整理为代理可遵循的工作流。

<a name="security"></a>

## 安全性

Figwright 自身的数据传输都在本地进行：客户端启动服务器后通过 stdio 与它通信，服务器再通过 `127.0.0.1:3055` 上的 WebSocket 与插件通信。Figwright 没有云服务，也不会发送遥测数据。MCP 客户端会收到工具返回结果；设计数据是否进一步发送给远程模型提供商，取决于客户端和你的配置。插件只使用 Figma 公开的 Plugin API 访问已打开的文件。

仅绑定 loopback 地址并不足以构成安全边界，因为你浏览的网页仍可能连接本地端口。因此，中继服务会检查每个请求中、网页无法随意伪造的两个请求头：**`Host`** 必须指向 loopback 地址，用于防止 DNS rebinding；**`Origin`** 则允许插件沙箱的握手，拒绝其他浏览器来源。Leader 的 HTTP 端点还要求使用必须先通过 CORS 预检才能发送的媒体类型。通用安全原则请参阅 [MCP Security Best Practices](https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices)；Figwright 的威胁模型、覆盖范围和私下报告漏洞的方式，请见 [SECURITY.md](./SECURITY.md)。

**使用 Figwright 并不意味着可以省去对代理操作的审核。** 写入工具会修改 Figma 文件，导出工具则会将文件写入代理指定的路径。如果代理受到恶意设计内容或提示注入指令的影响，这两类工具都可能被滥用。MCP 客户端的工具调用审批机制才是关键防线。

<a name="faq"></a>

## 常见问题

<details>
<summary><strong>服务器无法启动：出现 <code>command not found</code>，或以 <code>-32000</code>（“Connection closed”）错误断开连接。</strong></summary>

这两种情况都与 MCP 客户端启动服务器的方式有关：它会直接执行 `command`，不会经过交互式 shell，因此也不会加载 shell 启动时的配置。使用 **fnm、nvm、asdf、volta、mise** 等 Node 版本管理工具时尤其常见，因为它们通常通过终端启动时的 shell hook 配置 `PATH` 和 npm。这并非 Figwright 特有的问题，任何通过 `npx` 启动的 MCP 服务器都可能遇到。以下两种症状需要分别处理。

**`command not found`：客户端无法从 `PATH` 找到 `npx`／`node`。**

- **改用绝对路径。** 在普通终端中执行 `which npx`（或 `which node`），再将得到的完整路径填入 `command`：

  ```json
  {
    "mcpServers": {
      "figwright": {
        "command": "/Users/you/.local/share/fnm/node-versions/v24.x.x/installation/bin/npx",
        "args": ["-y", "@figwright/mcp@latest"]
      }
    }
  }
  ```

- **或通过 `env` 传入 `PATH`。** 如果客户端支持为单个服务器配置 `env`，请将版本管理工具的 `bin` 目录加入 `env.PATH`。

**`-32000`／“Connection closed”／始终无法连接：`npx` 已运行，但服务器在握手前即退出。**

`npx … @latest` **每次**启动都会向软件包仓库（registry）查询最新版本。在客户端直接启动的环境中，这一步可能失败或停滞，例如 npm 配置未加载或与终端不同、公司代理服务器或私有 registry 尚未配置，或当时无法联网。进程因此在 MCP 建立连接前就退出，客户端便会显示连接已关闭。（可执行文件的 shebang 找不到 `node` 时，也会出现这种情况。）

可以先安装软件包，让启动过程不必再从 registry 下载：

- **安装为项目依赖。** 安装后，请从配置中**移除 `@latest`**。这个标签会强制查询 registry；移除后，`npx` 就会使用 `node_modules` 中已安装的版本（例如 Claude Code 的 `.mcp.json` 等项目级配置，会从项目根目录启动进程）：

  ```bash
  pnpm add -D @figwright/mcp   # 或：npm i -D @figwright/mcp
  ```

  ```json
  {
    "mcpServers": {
      "figwright": {
        "command": "npx",
        "args": ["-y", "@figwright/mcp"]
      }
    }
  }
  ```

- **或全局安装，直接指定可执行文件。** 安装一次后，让 `command` 直接指向可执行文件，即可省去 `npx` 和每次启动时的版本查询。请使用 `which figwright-mcp` 查到的绝对路径：

  ```bash
  npm i -g @figwright/mcp
  which figwright-mcp
  ```

  ```json
  {
    "mcpServers": {
      "figwright": {
        "command": "/absolute/path/to/figwright-mcp"
      }
    }
  }
  ```

</details>

<details>
<summary><strong>插件一直显示“Waiting”，无法连接。</strong></summary>

服务器由 MCP 客户端启动，因此只会在客户端运行期间工作。请确认：

- MCP 客户端正在运行，且已配置 Figwright（可尝试调用 `ping`）。
- 插件已在同一台电脑、**同一个** Figma 应用中打开（中继服务只能通过本地 `127.0.0.1` 访问）。
- 本地 loopback 连接没有被阻止；部分防火墙或安全工具可能会拦截。

</details>

<details>
<summary><strong>如何确认服务器与插件版本兼容？</strong></summary>

插件的 **Debug** 标签页会并列显示服务器与插件版本，可以直接比较差异。

通常不需要手动检查，因为插件会主动提示影响兼容性的版本差异。服务器与插件的更新渠道不同：服务器通过 `npx @latest` 在每次启动时查询最新版本；插件则需要手动导入 zip 更新。因此，版本不同步是常态。问题也不一定会报错：旧版处理函数会直接忽略不支持的参数，导致工具报告成功，却只完成部分要求。当插件版本旧到可能影响执行结果时，面板会显示警告和更新方式，每次工具返回结果也会告知代理，该结果未经验证。

不影响使用的版本差异不会触发警告，例如服务器虽然更新了版本，却没有更改参数，插件即使落后一个版本也不影响使用。如出现警告，请按提示更新插件。

</details>

<details>
<summary><strong>需要付费的 Figma 方案或 Dev Mode 吗？</strong></summary>

不需要。Figwright 通过插件与 Figma 通信，免费套餐即可使用，无需 Dev Mode 席位或其他付费套餐。

</details>

<details>
<summary><strong>可以在 Dev Mode 和 FigJam 中使用吗？</strong></summary>

可以，但可用功能少于 Figma Design。这是编辑器提供给插件的 API 限制，并非 Figwright 刻意限制功能。

- **Figma Design**：支持完整功能。
- **Dev Mode**（Inspect 面板）：只能读取与导出。Figma 在此模式下只允许插件读取，因此截图、PDF 导出和所有检查工具都能使用，但任何写入都会失败，包括节点、页面、变量和样式。适合用来生成代码；如需创建或修改设计，请切回 Design 模式。（面板也不提供调整大小和 **Run in background**，因为这里的窗口由 Figma 控制。）
- **FigJam**：可操作画框、分区、形状和文本；此编辑器没有组件、变量、样式或 Motion，因此不适用这些工具。

`get_metadata` 会返回编辑器信息（`editorType`／`mode`）。如果工具因编辑器限制而失败，错误信息也会说明原因，让代理能调整做法，而不是反复重试。

</details>

<details>
<summary><strong>多个代理可以同时使用同一个插件吗？</strong></summary>

可以。多个 MCP 服务器通过 leader／follower **选举机制**共用同一个插件：其中一个担任 leader，其余作为 follower；leader 退出时会自动交接。

</details>

<details>
<summary><strong>两个代理可以同时处理不同的 Figma 文件吗？</strong></summary>

可以，需要先让每个代理分别绑定文件。

默认情况下，工具调用会发送到你最近操作的文件，切换标签页也就改变了代理看到的内容。这适合单个代理，但两个代理同时工作时，后台文件的代理可能会在不知情的情况下获取另一份文件的节点。只要同时打开多份文件，而代理尚未绑定其中一份，每次返回结果都会提醒它先绑定，避免基于错误的文件继续工作。

`list_files` 会列出当前已打开插件的所有文件，`use_file` 则将其中一份绑定给该代理：

```text
> 使用营销网站的文件
  → use_file({ fileName: "Marketing Site" })
```

绑定只属于该代理自己的服务器进程，不会影响其他代理；即使关闭后重新打开插件面板，绑定也会保留。文件标签页放在后台时，工具调用仍会发送到该文件。绑定以进程为单位，每个 MCP 客户端各有一个，因此要让代理分别使用两个客户端，例如两个编辑器或两个终端。同一个客户端里的所有代理（包括子代理）共用服务器，因此共用同一份文件绑定。如果两个已打开的文件同名，`use_file` 不会猜测，而是要求使用 `list_files` 列出的 `sessionId`。调用 `use_file({ release: true })` 可以解除绑定，回到跟随前台文件的模式。

</details>

<a name="contributing"></a>

## 参与贡献

欢迎参与贡献。开发环境配置和提交 pull request 的流程，请参阅 **[CONTRIBUTING.md](./CONTRIBUTING.md)**；架构、目录结构、技术栈和开发约定，请见 **[AGENTS.md](./AGENTS.md)**。

<a name="whats-in-the-name"></a>

## 名字的由来

`figwright` 沿用英文 **_-wright_** 的命名传统，这个古老词语指的是制作者或工匠：**playwright** 写剧本、**shipwright** 造船、**wheelwright** 制作车轮。名字也向浏览器自动化工具 [**Playwright**](https://playwright.dev) 致意：Playwright 操作浏览器，**Figwright** 则操作 Figma，既能读取画布，也能创建和修改设计。

<a name="license"></a>

## 许可证

[MIT](./LICENSE) © Roya
