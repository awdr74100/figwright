# Security Policy

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, use [GitHub private vulnerability reporting](https://github.com/awdr74100/figwright/security/advisories/new): go to the [Security tab](https://github.com/awdr74100/figwright/security) and click **Report a vulnerability**. The report stays private between you and the maintainer until a fix is released.

What to expect:

- **Acknowledgement within 3 days.** Figwright is maintained by one person, so please allow a little slack across time zones and weekends.
- An assessment of impact and affected versions, and a fix timeline proportional to severity.
- Credit in the published advisory and release notes, unless you prefer to stay anonymous.

Please include reproduction steps, the affected tool or component, and your Figwright version (the `@figwright/mcp` version from your MCP client config, plus the plugin build if relevant).

## Supported versions

Only the **latest release** of `@figwright/mcp` and the bundled Figma plugin receives security fixes. If you are on an older version, update before reporting — the issue may already be fixed.

## Security model

Figwright runs **entirely on your machine**; there is no Figwright cloud service.

- **Where it runs.** Your MCP client launches the `@figwright/mcp` server locally and talks to it over stdio. The server relays to the Figma plugin over a WebSocket bound to `127.0.0.1` (port 3055) — it is never exposed to the network.
- **What it can access.** The plugin runs in Figma's plugin sandbox and uses the official public Plugin API — the same API every Community plugin uses. It can only touch the Figma file you have open; it cannot reach your other files, your account, or your org's data, because the Plugin API doesn't expose them.
- **What leaves your machine.** Nothing. Figwright sends no telemetry and phones home to no one. Design data flows only between the plugin, the local relay, and your MCP client.
- **File writes.** Export tools (screenshots, PDF, video, image fills) write only to the paths your agent explicitly passes in the tool call — the server never writes anywhere it wasn't asked to.

Reports are in scope even when the trigger is a malicious Figma document or prompt-injected tool input: if Figwright's handling of untrusted input lets an attacker escalate beyond the boundaries above, we want to know.

Thanks for helping keep Figwright and its users safe.
