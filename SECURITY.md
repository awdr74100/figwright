# Security Policy

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, use [GitHub private vulnerability reporting](https://github.com/awdr74100/figwright/security/advisories/new): go to the [Security tab](https://github.com/awdr74100/figwright/security) and click **Report a vulnerability**. The report stays private between you and the maintainer until a fix is released.

What to expect:

- **Acknowledgement within 3 days.** Figwright is maintained by one person, so please allow a little slack across time zones and weekends.
- An assessment of impact and affected versions, and a fix timeline proportional to severity.
- **Coordinated disclosure.** Please keep the report private until a fix is released. We will agree on a publication date with you and aim to publish an advisory within 90 days of triage, sooner for severe issues.
- Credit in the published advisory and release notes, unless you prefer to stay anonymous.

Please include reproduction steps, the affected tool or component, and your Figwright version (the `@figwright/mcp` version from your MCP client config, plus the plugin build if relevant).

## Supported versions

Only the **latest release** of `@figwright/mcp` and the bundled Figma plugin receives security fixes. If you are on an older version, update before reporting; the issue may already be fixed.

## Security model

Figwright runs **entirely on your machine**; there is no Figwright cloud service.

- **Where it runs.** Your MCP client launches the `@figwright/mcp` server locally and talks to it over stdio. The server relays to the Figma plugin over a WebSocket bound to `127.0.0.1` (port 3055), so it is not reachable from your network.
- **Who can talk to it.** Binding to loopback is not by itself a boundary: a web page you visit can open a WebSocket to a local port or send it a form-style POST without any same-origin check, and DNS rebinding can make a page's own domain resolve to `127.0.0.1`. Figwright gates every request, WebSocket upgrades included, on the two headers a page cannot forge:
  - **`Host`** must name loopback (`localhost`, `127.0.0.1`, `[::1]`). A rebound request still carries the attacker's domain here, which is what makes this the check that stops rebinding, including on `GET`, where the browser considers itself same-origin, sends no `Origin`, and would otherwise be able to read the reply.
  - **`Origin`** must be absent (a follower process or the plugin host, neither of which is a browser) or the plugin's sandboxed origin. The leader's HTTP endpoints (`/rpc`, `/ping`, `/abdicate`) are stricter still: they refuse **any** request carrying an `Origin`, and require a media type outside the set a page can send without a CORS preflight.

  If some environment's plugin host is ever refused, `FIGWRIGHT_ALLOW_ANY_ORIGIN=1` lifts the origin gate; please report it rather than leaving it set. It deliberately does not lift the host gate. What none of this defends against is another program already running as you on the same machine; see the note on a compromised machine below.

- **What it can access.** The plugin runs in Figma's plugin sandbox and uses the official public Plugin API, the same one every Community plugin uses. It can only touch the Figma file you have open; it cannot reach your other files, your account, or your org's data, because the Plugin API doesn't expose them.
- **What leaves your machine.** Nothing. Figwright sends no telemetry and phones home to no one. Design data flows only between the plugin, the local relay, and your MCP client.
- **File writes.** Export tools (screenshots, PDF, video, image fills) write only to the paths your agent explicitly passes in the tool call; the server never writes anywhere it wasn't asked to.

## Scope

**In scope:** anything that lets an attacker cross the boundaries above, including when the trigger is a malicious Figma document or prompt-injected tool input. If Figwright's handling of untrusted input lets an attacker escalate beyond what this document describes, we want to know.

**Out of scope, please report these where they belong:**

- **Vulnerabilities in dependencies.** Report them to the upstream maintainers (or via the [npm contact form](https://www.npmjs.com/support)); open a regular issue here if Figwright needs to bump a patched release.
- **Bugs in Figma itself** (the desktop app, the Plugin API sandbox): report to [Figma](https://www.figma.com/security/).
- **Bugs in your MCP client** (Claude Code, Cursor, etc.): report to that project.
- **Prompt injection against the AI agent itself.** An agent following bad instructions embedded in a design file is a limitation of LLM-based tooling, not a Figwright vulnerability, unless Figwright's handling of that input breaks the boundaries above, which _is_ in scope.
- **An already-compromised machine.** Malware running with your user privileges can do everything Figwright can and more; that is not a boundary Figwright can defend.

Thanks for helping keep Figwright and its users safe.
