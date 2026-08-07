// Wire probe for @modelcontextprotocol/server upgrades. Boots the built server over stdio and
// snapshots everything an MCP client can observe; run it once before the bump and once after, then
// diff. `packages/mcp/test/e2e/mcp-wire.test.ts` is the standing gate that says pass/fail against
// what the specs declare; this says *what moved* between two SDK versions, which a boolean can't.
//
// It speaks raw newline-delimited JSON-RPC instead of the SDK's own Client on purpose: a probe built
// out of the package under test can hide that package's regression, because both ends move together.
//
// Usage:
//   node probe.mjs <repo-root> <out.json>
//   node probe.mjs --diff <base.json> <after.json>

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const CALL_TIMEOUT_MS = 20_000;

/** The installed version, read off the lockfile — the SDK's exports map hides its own package.json. */
const installedSdkVersion = repo => {
  const lock = readFileSync(`${repo}/pnpm-lock.yaml`, 'utf8');
  return /@modelcontextprotocol\/server@([\d.]+)/.exec(lock)?.[1] ?? 'unknown';
};

/**
 * One server process plus a JSON-RPC channel to it. A random high port keeps the probe off
 * DEFAULT_PORT (3055) so it can't contend with a real server or steal a connected plugin;
 * FIGWRIGHT_PORT is the seam packages/mcp/src/index.ts already exposes for exactly this.
 */
const session = repo => {
  const port = String(20_000 + Math.floor(Math.random() * 20_000));
  const child = spawn(process.execPath, [`${repo}/packages/mcp/dist/index.mjs`], {
    env: { ...process.env, FIGWRIGHT_PORT: port },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const stderr = [];
  child.stderr.on('data', chunk => stderr.push(String(chunk)));

  const pending = new Map();
  createInterface({ input: child.stdout }).on('line', line => {
    if (line.trim() === '') return;
    const message = JSON.parse(line);
    const settle = pending.get(message.id);
    if (settle !== undefined) {
      pending.delete(message.id);
      settle(message);
    }
  });

  let nextId = 1;
  const send = payload => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...payload })}\n`);

  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, message => {
        if (message.error) reject(new Error(`${method}: ${JSON.stringify(message.error)}`));
        else resolve(message.result);
      });
      send({ id, method, params });
      setTimeout(
        () => reject(new Error(`${method} timed out after ${CALL_TIMEOUT_MS}ms\n${stderr.join('')}`)),
        CALL_TIMEOUT_MS,
      ).unref();
    });

  const initialize = async protocolVersion => {
    const result = await call('initialize', {
      protocolVersion,
      capabilities: {},
      clientInfo: { name: 'mcp-sdk-audit-probe', version: '0.0.0' },
    });
    send({ method: 'notifications/initialized' });
    return result;
  };

  return { call, initialize, close: () => child.kill() };
};

const capture = async repo => {
  // Asking for a version the server can't know is the standard way to make it name its own latest:
  // it answers with the newest it speaks. That number is what an SDK bump silently moves.
  const current = session(repo);
  const init = await current.initialize('9999-01-01');

  // A second process asks as an old client would, to see what the server downgrades to. It has to be
  // its own process — initialize happens once per connection.
  const legacy = session(repo);
  const legacyInit = await legacy.initialize('2024-11-05');
  legacy.close();

  const { tools } = await current.call('tools/list');
  const { prompts } = await current.call('prompts/list');
  // ping answers without a plugin connected; what's under test is that a call round-trips and the
  // content-block shape holds, not the reading itself.
  const ping = await current.call('tools/call', { name: 'ping', arguments: {} });
  current.close();

  return {
    sdkVersion: installedSdkVersion(repo),
    serverLatestProtocol: init.protocolVersion,
    negotiatedWithOldClient: legacyInit.protocolVersion,
    serverInfo: init.serverInfo,
    capabilities: init.capabilities,
    instructions: init.instructions ?? null,
    toolCount: tools.length,
    promptCount: prompts.length,
    // Each tool exactly as the wire carries it — the whole object, not a chosen subset. An earlier
    // version stored only inputSchema and annotations, and so reported "no change" across the v1→v2
    // upgrade that silently dropped `execution.taskSupport` from all 112 tools, and across a
    // rewritten tool description. What an audit needs to know is precisely the thing nobody thought
    // to allowlist, so the allowlist is the bug: capture everything and let the diff find it.
    tools: Object.fromEntries(
      tools
        .map(tool => [
          tool.name,
          { hash: createHash('sha256').update(stable(tool)).digest('hex').slice(0, 12), tool },
        ])
        .toSorted(([a], [b]) => a.localeCompare(b)),
    ),
    prompts: prompts.toSorted((a, b) => a.name.localeCompare(b.name)),
    pingResultKeys: Object.keys(ping).toSorted(),
    pingContentTypes: (ping.content ?? []).map(block => block.type),
  };
};

/** Key-sorted JSON, so member order never registers as a difference the wire cannot express. */
const stable = value =>
  JSON.stringify(value, (_key, v) =>
    v !== null && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).toSorted(([a], [b]) => a.localeCompare(b)))
      : v,
  );

const readSnapshot = path => JSON.parse(readFileSync(path, 'utf8'));

const SCALAR_FIELDS = [
  'serverLatestProtocol',
  'negotiatedWithOldClient',
  'capabilities',
  'instructions',
  'toolCount',
  'promptCount',
  'pingResultKeys',
  'pingContentTypes',
];

const isLeaf = value => value === null || typeof value !== 'object';

/** Every key path in a JSON Schema, so two schemas can be compared by shape rather than by text. */
const keyPaths = (value, prefix = '', out = new Set()) => {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) keyPaths(item, `${prefix}[${index}]`, out);
  } else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      const path = prefix === '' ? key : `${prefix}.${key}`;
      out.add(path);
      keyPaths(item, path, out);
    }
  }
  return out;
};

/**
 * How two schemas differ, as added/removed paths plus changed leaves. The interesting SDK
 * regressions are structural — a `$ref`/`$defs`/`additionalProperties` appearing where clients did
 * not expect it — and those show up here as one line instead of two schema dumps.
 */
const schemaDelta = (before, after) => {
  const [a, b] = [keyPaths(before), keyPaths(after)];
  const added = [...b].filter(path => !a.has(path));
  const removed = [...a].filter(path => !b.has(path));
  const changed = [...a]
    .filter(path => b.has(path))
    .filter(path => {
      // Segments are dot-joined for object keys and bracketed for array indices (`arguments[0].x`),
      // so a plain split('.') cannot walk them — it would look up the literal key "arguments[0]",
      // find nothing, and report every changed leaf inside an array as unlocatable.
      const at = source =>
        [...path.matchAll(/[^.[\]]+/g)].reduce((node, [key]) => node?.[key], source);
      const [x, y] = [at(before), at(after)];
      return isLeaf(x) && isLeaf(y) && x !== y;
    });
  const parts = [];
  if (added.length > 0) parts.push(`+ ${added.join(', ')}`);
  if (removed.length > 0) parts.push(`- ${removed.join(', ')}`);
  if (changed.length > 0) parts.push(`~ ${changed.join(', ')}`);
  // Identical paths with a different hash means an array reordered or a leaf moved; fall back to the
  // raw text so the change is never reported as nothing.
  return parts.length > 0 ? parts.join('\n    ') : 'same key paths, different serialization';
};

const line = (label, before, after) =>
  `${label}: ${JSON.stringify(before)} → ${JSON.stringify(after)}`;

const report = (base, after) => {
  const findings = [];

  for (const field of SCALAR_FIELDS) {
    const [a, b] = [JSON.stringify(base[field]), JSON.stringify(after[field])];
    if (a !== b) findings.push(line(field, base[field], after[field]));
  }

  const [names, afterNames] = [Object.keys(base.tools), Object.keys(after.tools)];
  const added = afterNames.filter(name => !(name in base.tools));
  const removed = names.filter(name => !(name in after.tools));
  if (added.length > 0) findings.push(`tools added: ${added.join(', ')}`);
  if (removed.length > 0) findings.push(`tools removed: ${removed.join(', ')}`);

  for (const name of names.filter(n => n in after.tools)) {
    const [a, b] = [base.tools[name], after.tools[name]];
    if (a.hash !== b.hash) findings.push(`tool changed — ${name}\n    ${schemaDelta(a.tool, b.tool)}`);
  }

  // Same treatment the tools get: name the path that moved rather than dumping both lists, which
  // for a one-word description change is two screens of identical text with the difference buried.
  if (stable(base.prompts) !== stable(after.prompts)) {
    findings.push(`prompts changed\n    ${schemaDelta(base.prompts, after.prompts)}`);
  }

  console.log(`${base.sdkVersion} → ${after.sdkVersion}`);
  if (findings.length === 0) {
    console.log('no wire-observable change');
    return;
  }
  console.log(`${findings.length} wire-observable change(s):`);
  for (const finding of findings) console.log(`  - ${finding}`);
};

const [first, second, third] = process.argv.slice(2);

if (first === '--diff') {
  if (second === undefined || third === undefined) {
    throw new Error('usage: node probe.mjs --diff <base.json> <after.json>');
  }
  report(readSnapshot(second), readSnapshot(third));
} else {
  if (first === undefined || second === undefined) {
    throw new Error('usage: node probe.mjs <repo-root> <out.json>');
  }
  const snapshot = await capture(first);
  writeFileSync(second, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(
    `sdk=${snapshot.sdkVersion} latest=${snapshot.serverLatestProtocol} ` +
      `old-client=${snapshot.negotiatedWithOldClient} tools=${snapshot.toolCount} ` +
      `prompts=${snapshot.promptCount} → ${second}`,
  );
}
