#!/usr/bin/env node
import {
  HappyCodeAgent,
  SUPPORTED_MODES,
  allowCommandPrefix,
  clearCommandApprovals,
  getApprovalPath,
  getApprovalPrefixes,
  getAuditPath,
  getConfigPath,
  getPolicyPath,
  readConfig,
  readRecentAudit,
  writeConfig,
  writeDefaultPolicy
} from "./chunk-QKBHKYFE.js";

// src/cli.ts
import React2 from "react";
import { Command } from "commander";
import { render } from "ink";

// src/agents_runtime.ts
var MultiAgentRuntime = class {
  constructor(agent) {
    this.agent = agent;
  }
  async runTasks(baseMessages, tasks, context) {
    const outputs = [];
    for (const task of tasks) {
      const result = await this.agent.chatStream(
        [...baseMessages, { role: "user", content: task.prompt }],
        {
          mode: task.mode,
          cwd: context.cwd,
          enableAudit: context.enableAudit,
          maxTurns: context.maxTurns ?? 6
        }
      );
      outputs.push({
        name: task.name,
        mode: task.mode,
        output: result
      });
    }
    return outputs;
  }
  static formatResults(results) {
    return results.map((item) => `# Agent: ${item.name} (${item.mode})
${item.output}`).join("\n\n");
  }
};

// src/memory.ts
import fs from "fs";
import os from "os";
import path from "path";
import { exec } from "child_process";
var GLOBAL_MEMORY_PATH = path.join(os.homedir(), ".happycode", "memory_user.md");
var LEGACY_MEMORY_PATH = path.join(os.homedir(), ".happycode", "memory.md");
var PROJECT_MEMORY_FILE = ".happycode-memory.md";
var MEMORY_PROMPT_MAX_CHARS = 2400;
var SECTION_LABELS = {
  facts: "Facts",
  preferences: "Preferences",
  constraints: "Constraints",
  notes: "Notes"
};
var SECTION_PRIORITY = ["constraints", "preferences", "facts", "notes"];
function normalizeLine(text) {
  return text.replace(/\s+/g, " ").trim();
}
function emptyDocument(scope) {
  return {
    scope,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    facts: [],
    preferences: [],
    constraints: [],
    notes: []
  };
}
function parseSectionLabel(raw) {
  const normalized = normalizeLine(raw).toLowerCase();
  if (normalized === "facts") {
    return "facts";
  }
  if (normalized === "preferences") {
    return "preferences";
  }
  if (normalized === "constraints") {
    return "constraints";
  }
  if (normalized === "notes") {
    return "notes";
  }
  return null;
}
function parseMemoryMarkdown(content, scope) {
  const doc = emptyDocument(scope);
  let activeSection = null;
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed.startsWith("# ")) {
      continue;
    }
    if (trimmed.startsWith("## ")) {
      activeSection = parseSectionLabel(trimmed.slice(3));
      continue;
    }
    if (trimmed.startsWith("- updatedAt:")) {
      const raw = normalizeLine(trimmed.slice("- updatedAt:".length));
      if (raw) {
        doc.updatedAt = raw;
      }
      continue;
    }
    if (!activeSection) {
      continue;
    }
    const value = trimmed.startsWith("- ") ? normalizeLine(trimmed.slice(2)) : normalizeLine(trimmed);
    if (!value) {
      continue;
    }
    doc[activeSection].push(value);
  }
  return doc;
}
function toMemoryMarkdown(doc) {
  const lines = [
    "# HappyCode Memory",
    "## Meta",
    `- scope: ${doc.scope}`,
    `- updatedAt: ${doc.updatedAt}`
  ];
  for (const section of SECTION_PRIORITY) {
    lines.push(`## ${SECTION_LABELS[section]}`);
    const entries = doc[section];
    if (entries.length === 0) {
      lines.push("- (empty)");
      continue;
    }
    for (const item of entries) {
      lines.push(`- ${item}`);
    }
  }
  return `${lines.join("\n")}
`;
}
function defaultMemoryMarkdown(scope) {
  return toMemoryMarkdown(emptyDocument(scope));
}
function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}
function scopePath(scope, cwd = process.cwd()) {
  if (scope === "user") {
    return GLOBAL_MEMORY_PATH;
  }
  return path.join(cwd, PROJECT_MEMORY_FILE);
}
function enforceUniqueSection(items) {
  const seen = /* @__PURE__ */ new Set();
  const deduped = [];
  for (const item of items) {
    const normalized = normalizeLine(item);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    deduped.push(normalized);
  }
  return deduped;
}
function truncateBlock(lines, limit) {
  const buffer = [];
  for (const line of lines) {
    const next = buffer.length === 0 ? line : `${buffer.join("\n")}
${line}`;
    if (next.length > limit) {
      if (buffer.length === 0) {
        return `${line.slice(0, Math.max(0, limit - 3))}...`;
      }
      return `${buffer.join("\n")}
...`;
    }
    buffer.push(line);
  }
  return buffer.join("\n");
}
function buildScopePrompt(title, doc, limit) {
  const lines = [title];
  for (const section of SECTION_PRIORITY) {
    const entries = doc[section];
    if (entries.length === 0) {
      continue;
    }
    lines.push(`${SECTION_LABELS[section]}:`);
    for (const entry of entries) {
      lines.push(`- ${entry}`);
    }
  }
  if (lines.length === 1) {
    lines.push("- (empty)");
  }
  return truncateBlock(lines, limit);
}
function getMemoryPath() {
  return GLOBAL_MEMORY_PATH;
}
function getProjectMemoryPath(cwd = process.cwd()) {
  return scopePath("project", cwd);
}
function readMemoryDocument(scope = "user", cwd = process.cwd()) {
  const target = scopePath(scope, cwd);
  if (!fs.existsSync(target)) {
    if (scope === "user" && fs.existsSync(LEGACY_MEMORY_PATH)) {
      const legacy = fs.readFileSync(LEGACY_MEMORY_PATH, "utf8");
      const migrated = parseMemoryMarkdown(legacy, scope);
      writeMemoryDocument(scope, migrated, cwd);
      return migrated;
    }
    return emptyDocument(scope);
  }
  const raw = fs.readFileSync(target, "utf8");
  return parseMemoryMarkdown(raw, scope);
}
function writeMemoryDocument(scope, doc, cwd = process.cwd()) {
  const target = scopePath(scope, cwd);
  ensureParentDir(target);
  const normalized = {
    ...doc,
    scope,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    facts: enforceUniqueSection(doc.facts),
    preferences: enforceUniqueSection(doc.preferences),
    constraints: enforceUniqueSection(doc.constraints),
    notes: enforceUniqueSection(doc.notes)
  };
  fs.writeFileSync(target, toMemoryMarkdown(normalized), "utf8");
}
function ensureMemoryFile(scope, cwd = process.cwd()) {
  const target = scopePath(scope, cwd);
  if (!fs.existsSync(target)) {
    ensureParentDir(target);
    fs.writeFileSync(target, defaultMemoryMarkdown(scope), "utf8");
  }
  return target;
}
async function openMemoryFile(scope, cwd = process.cwd()) {
  const target = ensureMemoryFile(scope, cwd);
  const escaped = target.replace(/"/g, '\\"');
  const command = process.platform === "win32" ? `start "" "${escaped}"` : process.platform === "darwin" ? `open "${escaped}"` : `xdg-open "${escaped}"`;
  return new Promise((resolve) => {
    exec(command, (error) => {
      if (error) {
        resolve({
          ok: false,
          path: target,
          message: `Failed to open memory file automatically: ${error.message}`
        });
        return;
      }
      resolve({
        ok: true,
        path: target,
        message: `Opened ${scope} memory file.`
      });
    });
  });
}
function buildRuntimeMemoryPrompt(cwd = process.cwd(), maxChars = MEMORY_PROMPT_MAX_CHARS) {
  const userDoc = readMemoryDocument("user", cwd);
  const projectDoc = readMemoryDocument("project", cwd);
  const perScope = Math.max(200, Math.floor(maxChars / 2));
  const userBlock = buildScopePrompt("User Memory:", userDoc, perScope);
  const projectBlock = buildScopePrompt("Project Memory:", projectDoc, perScope);
  const merged = [
    "[Persistent Memory]",
    userBlock,
    "",
    projectBlock,
    "",
    "Use memory as soft constraints. If explicit user request conflicts in this turn, follow current request."
  ].join("\n").trim();
  if (merged === "[Persistent Memory]") {
    return "";
  }
  if (merged.length <= maxChars) {
    return merged;
  }
  return `${merged.slice(0, Math.max(0, maxChars - 3))}...`;
}

// src/mcp.ts
import fs2 from "fs";
import path2 from "path";
var MCP_CONFIG_NAME = ".happycode-mcp.json";
function getMcpConfigPath(cwd) {
  return path2.join(cwd, MCP_CONFIG_NAME);
}
function loadMcpConfig(cwd) {
  const p = getMcpConfigPath(cwd);
  if (!fs2.existsSync(p)) {
    return { servers: [] };
  }
  try {
    const raw = fs2.readFileSync(p, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.servers)) {
      return { servers: [] };
    }
    return parsed;
  } catch {
    return { servers: [] };
  }
}
function saveMcpConfig(cwd, config) {
  const p = getMcpConfigPath(cwd);
  fs2.writeFileSync(p, `${JSON.stringify(config, null, 2)}
`, "utf8");
  return p;
}
function initMcpConfig(cwd) {
  const existing = loadMcpConfig(cwd);
  if (existing.servers.length > 0) {
    return getMcpConfigPath(cwd);
  }
  return saveMcpConfig(cwd, {
    servers: [
      {
        name: "example-mcp",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "."]
      }
    ]
  });
}

// src/mcp_client.ts
import { spawn } from "child_process";
var McpClientManager = class {
  servers = /* @__PURE__ */ new Map();
  async ensureServers(config) {
    for (const server of config.servers) {
      if (this.servers.has(server.name)) {
        continue;
      }
      const proc = spawn(server.command, server.args ?? [], {
        stdio: "pipe",
        shell: process.platform === "win32"
      });
      const state = {
        name: server.name,
        proc,
        nextId: 1,
        buffer: "",
        pending: /* @__PURE__ */ new Map()
      };
      proc.stdout.setEncoding("utf8");
      proc.stdout.on("data", (chunk) => {
        this.handleStdout(state, chunk);
      });
      proc.stderr.setEncoding("utf8");
      proc.stderr.on("data", () => {
      });
      proc.on("exit", () => {
        for (const [, pending] of state.pending) {
          pending.reject(new Error(`MCP server exited: ${state.name}`));
        }
        state.pending.clear();
        this.servers.delete(state.name);
      });
      this.servers.set(server.name, state);
      await this.initializeServer(state);
    }
  }
  handleStdout(state, chunk) {
    state.buffer += chunk;
    while (true) {
      const idx = state.buffer.indexOf("\n");
      if (idx < 0) {
        break;
      }
      const line = state.buffer.slice(0, idx).trim();
      state.buffer = state.buffer.slice(idx + 1);
      if (!line) {
        continue;
      }
      try {
        const msg = JSON.parse(line);
        if (typeof msg.id !== "number") {
          continue;
        }
        const pending = state.pending.get(msg.id);
        if (!pending) {
          continue;
        }
        state.pending.delete(msg.id);
        if (msg.error) {
          pending.reject(new Error(msg.error.message));
        } else {
          pending.resolve(msg.result);
        }
      } catch {
        continue;
      }
    }
  }
  call(state, method, params) {
    return new Promise((resolve, reject) => {
      const id = state.nextId++;
      const payload = { jsonrpc: "2.0", id, method, params };
      state.pending.set(id, { resolve, reject });
      state.proc.stdin.write(`${JSON.stringify(payload)}
`, "utf8");
    });
  }
  async initializeServer(state) {
    await this.call(state, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "happycode", version: "0.1.0" }
    });
    await this.call(state, "notifications/initialized");
  }
  async listTools() {
    const results = [];
    for (const [, state] of this.servers) {
      try {
        const raw = await this.call(state, "tools/list");
        const tools = raw?.tools ?? [];
        for (const tool of tools) {
          results.push({
            server: state.name,
            name: tool.name,
            fullName: `mcp__${state.name}__${tool.name}`,
            description: tool.description ?? "",
            inputSchema: tool.inputSchema
          });
        }
      } catch {
        continue;
      }
    }
    return results;
  }
  async callTool(fullName, args) {
    const matched = /^mcp__([^_]+(?:_[^_]+)*)__(.+)$/.exec(fullName);
    if (!matched) {
      throw new Error(`Invalid MCP tool name: ${fullName}`);
    }
    const serverName = matched[1];
    const toolName = matched[2];
    const state = this.servers.get(serverName);
    if (!state) {
      throw new Error(`MCP server not connected: ${serverName}`);
    }
    const result = await this.call(state, "tools/call", {
      name: toolName,
      arguments: args
    });
    return JSON.stringify(result, null, 2);
  }
  async shutdown() {
    for (const [, state] of this.servers) {
      state.proc.kill();
    }
    this.servers.clear();
  }
};

// src/session.ts
import fs3 from "fs";
import os2 from "os";
import path3 from "path";
import { createHash } from "crypto";
var SESSION_ROOT = path3.join(os2.homedir(), ".happycode", "sessions");
var ACTIVE_FILE = path3.join(SESSION_ROOT, "active-session.txt");
var ACTIVE_MAP_FILE = path3.join(SESSION_ROOT, "active-sessions.json");
function ensureDir() {
  fs3.mkdirSync(SESSION_ROOT, { recursive: true });
}
function safeName(input) {
  return input.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60) || "session";
}
function resolveProjectRoot(cwd) {
  const target = path3.resolve(cwd);
  try {
    return fs3.realpathSync(target);
  } catch {
    return target;
  }
}
function toProjectKey(projectRoot) {
  const normalized = process.platform === "win32" ? projectRoot.toLowerCase() : projectRoot;
  return createHash("sha1").update(normalized).digest("hex").slice(0, 16);
}
function projectMetaFromCwd(cwd) {
  const projectRoot = resolveProjectRoot(cwd);
  return {
    projectRoot,
    projectKey: toProjectKey(projectRoot)
  };
}
function normalizeRecord(record) {
  return {
    ...record,
    toolEvents: Array.isArray(record.toolEvents) ? record.toolEvents : []
  };
}
function readActiveMap() {
  ensureDir();
  if (!fs3.existsSync(ACTIVE_MAP_FILE)) {
    return {};
  }
  try {
    const raw = fs3.readFileSync(ACTIVE_MAP_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
function writeActiveMap(map) {
  ensureDir();
  fs3.writeFileSync(ACTIVE_MAP_FILE, `${JSON.stringify(map, null, 2)}
`, "utf8");
}
function isProjectMatch(record, projectKey) {
  return !record.projectKey || record.projectKey === projectKey;
}
function sessionPathById(id) {
  return path3.join(SESSION_ROOT, `${id}.json`);
}
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function randomId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
function getSessionRootPath() {
  ensureDir();
  return SESSION_ROOT;
}
function getLegacySessionPath() {
  return path3.join(os2.homedir(), ".happycode", "session.json");
}
function createSession(name = "default", cwd = process.cwd()) {
  ensureDir();
  const meta = projectMetaFromCwd(cwd);
  const id = randomId();
  const record = {
    id,
    name: safeName(name),
    createdAt: nowIso(),
    updatedAt: nowIso(),
    messages: [],
    toolEvents: [],
    projectKey: meta.projectKey,
    projectRoot: meta.projectRoot
  };
  saveSessionRecord(record);
  setActiveSessionId(id, cwd);
  return record;
}
function saveSessionRecord(record) {
  ensureDir();
  const next = {
    ...record,
    name: safeName(record.name),
    toolEvents: Array.isArray(record.toolEvents) ? record.toolEvents : [],
    updatedAt: nowIso()
  };
  fs3.writeFileSync(sessionPathById(next.id), `${JSON.stringify(next, null, 2)}
`, "utf8");
}
function loadSessionById(id) {
  const p = sessionPathById(id);
  if (!fs3.existsSync(p)) {
    return null;
  }
  try {
    const raw = fs3.readFileSync(p, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.messages)) {
      return null;
    }
    return normalizeRecord(parsed);
  } catch {
    return null;
  }
}
function listSessions(cwd = process.cwd()) {
  ensureDir();
  const { projectKey } = projectMetaFromCwd(cwd);
  const files = fs3.readdirSync(SESSION_ROOT).filter((item) => item.endsWith(".json")).map((item) => path3.join(SESSION_ROOT, item));
  const sessions = [];
  for (const file of files) {
    try {
      const raw = fs3.readFileSync(file, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.messages)) {
        const normalized = normalizeRecord(parsed);
        if (isProjectMatch(normalized, projectKey)) {
          sessions.push(normalized);
        }
      }
    } catch {
      continue;
    }
  }
  sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return sessions;
}
function setActiveSessionId(id, cwd = process.cwd()) {
  ensureDir();
  const { projectKey } = projectMetaFromCwd(cwd);
  const map = readActiveMap();
  map[projectKey] = id;
  writeActiveMap(map);
  fs3.writeFileSync(ACTIVE_FILE, `${id}
`, "utf8");
}
function getActiveSessionId(cwd = process.cwd()) {
  const { projectKey } = projectMetaFromCwd(cwd);
  const map = readActiveMap();
  const scoped = map[projectKey];
  if (scoped) {
    return scoped;
  }
  if (fs3.existsSync(ACTIVE_FILE)) {
    try {
      const legacyId = fs3.readFileSync(ACTIVE_FILE, "utf8").trim();
      if (legacyId) {
        const record = loadSessionById(legacyId);
        if (record && isProjectMatch(record, projectKey)) {
          map[projectKey] = legacyId;
          writeActiveMap(map);
          return legacyId;
        }
      }
    } catch {
      return null;
    }
  }
  return null;
}
function loadActiveSession(cwd = process.cwd()) {
  const { projectKey } = projectMetaFromCwd(cwd);
  const id = getActiveSessionId(cwd);
  if (id) {
    const record = loadSessionById(id);
    if (record && isProjectMatch(record, projectKey)) {
      return record;
    }
  }
  return createSession("default", cwd);
}
function loadSessionMessages(cwd = process.cwd()) {
  const active = loadActiveSession(cwd);
  return active.messages;
}
function saveSessionMessages(messages, cwd = process.cwd()) {
  const active = loadActiveSession(cwd);
  active.messages = messages;
  saveSessionRecord(active);
}
function loadSessionToolEvents(cwd = process.cwd()) {
  const active = loadActiveSession(cwd);
  return active.toolEvents;
}
function saveSessionToolEvents(events, cwd = process.cwd()) {
  const active = loadActiveSession(cwd);
  active.toolEvents = events;
  saveSessionRecord(active);
}
function clearSession(cwd = process.cwd()) {
  const active = loadActiveSession(cwd);
  active.messages = [];
  active.toolEvents = [];
  saveSessionRecord(active);
}
function renameActiveSession(name, cwd = process.cwd()) {
  const active = loadActiveSession(cwd);
  active.name = safeName(name);
  saveSessionRecord(active);
  return active;
}
function forkActiveSession(name, cwd = process.cwd()) {
  const active = loadActiveSession(cwd);
  const clone = {
    id: randomId(),
    name: safeName(name ?? `${active.name}_fork`),
    createdAt: nowIso(),
    updatedAt: nowIso(),
    messages: [...active.messages],
    toolEvents: [...active.toolEvents],
    projectKey: active.projectKey,
    projectRoot: active.projectRoot
  };
  saveSessionRecord(clone);
  setActiveSessionId(clone.id, cwd);
  return clone;
}
function rewindActiveSession(steps, cwd = process.cwd()) {
  const active = loadActiveSession(cwd);
  const drop = Math.max(1, steps);
  const nextMessages = active.messages.slice(0, Math.max(0, active.messages.length - drop));
  const remainingUserTurns = nextMessages.filter((item) => item.role === "user").length;
  active.messages = nextMessages;
  active.toolEvents = active.toolEvents.filter((item) => item.turn <= remainingUserTurns);
  saveSessionRecord(active);
  return active;
}
function switchSession(id, cwd = process.cwd()) {
  const { projectKey } = projectMetaFromCwd(cwd);
  const target = loadSessionById(id);
  if (!target || !isProjectMatch(target, projectKey)) {
    return null;
  }
  setActiveSessionId(id, cwd);
  return target;
}

// src/ui.tsx
import fs4 from "fs";
import path4 from "path";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import TextInput from "ink-text-input";
import { jsx, jsxs } from "react/jsx-runtime";
var THEME_STYLES = {
  "black-yellow": {
    titleColor: "yellow",
    subtitleColor: "cyan",
    metaColor: "white",
    icon: ":)",
    spark: "\u2728"
  },
  cyber: {
    titleColor: "cyan",
    subtitleColor: "magenta",
    metaColor: "cyan",
    icon: ">>",
    spark: "\u26A1"
  },
  minimal: {
    titleColor: "green",
    subtitleColor: "gray",
    metaColor: "white",
    icon: ":|",
    spark: "-"
  }
};
var COMMANDS = [
  { cmd: "/help", complete: "/help", desc: "Show command help" },
  { cmd: "/status", complete: "/status", desc: "Show runtime status" },
  { cmd: "/config", complete: "/config", desc: "Show loaded config and runtime overrides" },
  { cmd: "/new", complete: "/new", desc: "Start new conversation" },
  { cmd: "/compact", complete: "/compact", desc: "Compact context" },
  { cmd: "/review", complete: "/review", desc: "Review current git diff" },
  { cmd: "/plan", complete: "/plan", desc: "Generate implementation plan" },
  { cmd: "/test [command]", complete: "/test", desc: "Run tests via tools" },
  { cmd: "/fix", complete: "/fix", desc: "Investigate and fix issues" },
  { cmd: "/mode plan|edit|auto", complete: "/mode ", desc: "Switch mode" },
  { cmd: "/theme", complete: "/theme ", desc: "Get or set UI theme" },
  { cmd: "/model [name]", complete: "/model ", desc: "Get or set model" },
  { cmd: "/permissions", complete: "/permissions", desc: "Show tool permission config" },
  { cmd: "/permissions allow <tool>", complete: "/permissions allow ", desc: "Allow specific tool" },
  { cmd: "/permissions deny <tool>", complete: "/permissions deny ", desc: "Deny specific tool" },
  { cmd: "/permissions clear", complete: "/permissions clear", desc: "Clear tool restrictions" },
  { cmd: "/resume", complete: "/resume", desc: "Open session picker (\u2191/\u2193 + Enter)" },
  { cmd: "/rewind <n>", complete: "/rewind ", desc: "Drop last N messages" },
  { cmd: "/rename <name>", complete: "/rename ", desc: "Rename current session" },
  { cmd: "/export [path]", complete: "/export ", desc: "Export transcript" },
  { cmd: "/context", complete: "/context", desc: "Show context summary" },
  { cmd: "/stats", complete: "/stats", desc: "Show local usage stats from audit log" },
  { cmd: "/usage", complete: "/usage", desc: "Alias for /stats" },
  { cmd: "/tasks", complete: "/tasks", desc: "Summarize pending tasks" },
  { cmd: "/todos", complete: "/todos", desc: "Generate TODO checklist" },
  { cmd: "/copy", complete: "/copy", desc: "Copy latest assistant response" },
  { cmd: "/debug", complete: "/debug", desc: "Show debug info" },
  { cmd: "/doctor", complete: "/doctor", desc: "Run environment checks" },
  { cmd: "/memory", complete: "/memory", desc: "Open memory file picker" },
  { cmd: "/memory user|project", complete: "/memory ", desc: "Open selected memory file" },
  { cmd: "/mcp", complete: "/mcp", desc: "Show MCP config status" },
  { cmd: "/mcp init", complete: "/mcp init", desc: "Create MCP config" },
  { cmd: "/agents [prompt]", complete: "/agents ", desc: "Run multi-agent orchestration" },
  { cmd: "/audit", complete: "/audit", desc: "Show recent audit logs" },
  { cmd: "/allow once <command>", complete: "/allow once ", desc: "Approve shell command prefix quickly" },
  { cmd: "/allow session <prefix>", complete: "/allow session ", desc: "Approve shell prefix for session" },
  { cmd: "/approvals", complete: "/approvals", desc: "Show command approvals" },
  { cmd: "/approvals clear", complete: "/approvals clear", desc: "Clear command approvals" },
  { cmd: "/policy init", complete: "/policy init", desc: "Create policy file" },
  { cmd: "/policy path", complete: "/policy path", desc: "Show policy path" },
  { cmd: "/init", complete: "/init", desc: "Show important file paths" },
  { cmd: "/clear", complete: "/clear", desc: "Clear conversation" },
  { cmd: "/exit", complete: "/exit", desc: "Quit" }
];
var HELP_TEXT = COMMANDS.map((item) => `${item.cmd.padEnd(34, " ")} ${item.desc}`).join("\n");
var MODE_CYCLE = ["plan", "edit", "auto"];
var MAX_RENDER_FLOW_ITEMS = 120;
var MAX_TOOL_EVENTS_STORE = 2e3;
var MAX_PREVIEW_LINES = 5;
var MAX_PREVIEW_CHARS = 560;
function pad2(value) {
  return String(value).padStart(2, "0");
}
function formatAbsoluteTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso || "unknown";
  }
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const hours = pad2(date.getHours());
  const minutes = pad2(date.getMinutes());
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}
function formatRelativeTime(iso, now = Date.now()) {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) {
    return "unknown";
  }
  const diffSeconds = Math.floor((now - ts) / 1e3);
  if (diffSeconds <= 30) {
    return "just now";
  }
  if (diffSeconds < 3600) {
    return `${Math.floor(diffSeconds / 60)}m ago`;
  }
  if (diffSeconds < 86400) {
    return `${Math.floor(diffSeconds / 3600)}h ago`;
  }
  return `${Math.floor(diffSeconds / 86400)}d ago`;
}
function formatToolTag(name) {
  const short = name.startsWith("mcp__") ? name.replace(/^mcp__/, "").replace(/__/g, "/") : name;
  return short.length > 28 ? `${short.slice(0, 27)}...` : short;
}
function getToolTagColor(name) {
  if (name.includes("shell") || name.includes("command")) {
    return "yellow";
  }
  if (name.includes("file") || name.includes("read") || name.includes("write")) {
    return "cyan";
  }
  if (name.includes("git")) {
    return "magenta";
  }
  if (name.startsWith("mcp__")) {
    return "blue";
  }
  if (name.includes("test")) {
    return "green";
  }
  return "red";
}
function getResultTypeBadge(step) {
  const preview = (step.preview ?? "").toLowerCase();
  const name = step.name.toLowerCase();
  if (name.includes("test") || preview.includes("test") || preview.includes("passed") || preview.includes("failed")) {
    return { icon: "[T]", label: "test" };
  }
  if (name.includes("diff") || preview.includes("diff") || preview.includes("@@") || preview.includes("+++")) {
    return { icon: "[D]", label: "diff" };
  }
  if (name.includes("shell") || name.includes("command") || preview.includes("exit code")) {
    return { icon: "\u{1F4BB}", label: "command" };
  }
  if (name.includes("read") || name.includes("write") || name.includes("file") || preview.includes("path")) {
    return { icon: "[F]", label: "file" };
  }
  if (name.startsWith("mcp__")) {
    return { icon: "[M]", label: "mcp" };
  }
  if (preview.startsWith("{") || preview.startsWith("[")) {
    return { icon: "[J]", label: "json" };
  }
  return { icon: "[R]", label: "result" };
}
function toPreviewText(text, maxLines = MAX_PREVIEW_LINES, maxChars = MAX_PREVIEW_CHARS) {
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n").slice(0, maxLines);
  const merged = lines.join("\n");
  if (merged.length > maxChars) {
    return `${merged.slice(0, maxChars)}...`;
  }
  if (normalized.length > merged.length) {
    return `${merged}
...`;
  }
  return merged;
}
function buildOptionSuggestions(inputValue, prefix, options, desc) {
  if (!inputValue.startsWith(prefix)) {
    return [];
  }
  const partial = inputValue.slice(prefix.length).trim();
  const needle = partial.toLowerCase();
  return options.filter((item) => item.toLowerCase().startsWith(needle)).map((item) => ({
    label: `${prefix}${item}`,
    insert: `${prefix}${item}`,
    desc,
    kind: "option"
  }));
}
function getCommandParamHint(command) {
  if (!command.complete.endsWith(" ")) {
    return "";
  }
  const raw = command.cmd.startsWith(command.complete) ? command.cmd.slice(command.complete.length).trim() : "";
  return raw;
}
function getInlineParamPlaceholder(input) {
  const matched = COMMANDS.find((item) => item.complete.endsWith(" ") && input === item.complete);
  if (!matched) {
    return "";
  }
  return getCommandParamHint(matched);
}
function countUserTurns(messages) {
  return messages.filter((item) => item.role === "user").length;
}
function parseMemoryScope(raw) {
  if (raw === "user" || raw === "project") {
    return raw;
  }
  return null;
}
function pushAssistant(text, setHistory, onHistoryChange) {
  setHistory((prev) => {
    const assistantMessage = { role: "assistant", content: text };
    const updated = [...prev, assistantMessage];
    onHistoryChange?.(updated);
    return updated;
  });
}
function parseMentionFiles(input, cwd) {
  const matches = [...input.matchAll(/@([^\s]+)/g)].map((m) => m[1]).filter(Boolean);
  const files = [];
  for (const item of matches) {
    const full = path4.resolve(cwd, item);
    if (fs4.existsSync(full) && fs4.statSync(full).isFile()) {
      files.push(item);
    }
  }
  return files;
}
function App({
  agent,
  initialHistory = [],
  onHistoryChange,
  defaultMode = "auto",
  enableAudit = true,
  defaultModel,
  appVersion = "0.1.0",
  defaultRuntime,
  mcpManager
}) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const initialMode = defaultRuntime?.mode ?? defaultMode;
  const [terminalColumns, setTerminalColumns] = useState(stdout.columns ?? 80);
  const [history, setHistory] = useState(initialHistory);
  const [input, setInput] = useState("");
  const [runtime, setRuntime] = useState({
    mode: initialMode,
    model: defaultRuntime?.model ?? defaultModel,
    fallbackModel: defaultRuntime?.fallbackModel,
    maxTurns: defaultRuntime?.maxTurns ?? 8,
    allowedTools: defaultRuntime?.allowedTools ?? [],
    disallowedTools: defaultRuntime?.disallowedTools ?? [],
    systemPrompt: defaultRuntime?.systemPrompt,
    appendSystemPrompt: defaultRuntime?.appendSystemPrompt
  });
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState("");
  const [toolEvents, setToolEvents] = useState([]);
  const [theme, setTheme] = useState("black-yellow");
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [inputKey, setInputKey] = useState(0);
  const [error, setError] = useState(null);
  const [modeIndicator, setModeIndicator] = useState({
    mode: initialMode,
    source: "init",
    updatedAt: Date.now()
  });
  const [resumePickerOpen, setResumePickerOpen] = useState(false);
  const [resumeCandidates, setResumeCandidates] = useState([]);
  const [resumeCursor, setResumeCursor] = useState(0);
  const [pendingUserQuestion, setPendingUserQuestion] = useState(null);
  const [questionFocus, setQuestionFocus] = useState("option");
  const [selectedTypeIndex, setSelectedTypeIndex] = useState(0);
  const [selectedOptionIndex, setSelectedOptionIndex] = useState(0);
  const [memoryPickerOpen, setMemoryPickerOpen] = useState(false);
  const [memoryPickerCursor, setMemoryPickerCursor] = useState(0);
  const pendingQuestionResolveRef = useRef(null);
  const toolSeqRef = useRef(0);
  const toolTurnRef = useRef(0);
  const toolEventsHydratedRef = useRef(false);
  const streamingBufferRef = useRef("");
  const streamingFlushTimerRef = useRef(null);
  const themeStyle = THEME_STYLES[theme];
  const projectName = useMemo(() => path4.basename(process.cwd()), []);
  const contentWidth = useMemo(() => Math.max(24, terminalColumns - 2), [terminalColumns]);
  const flowSeparator = useMemo(() => "-".repeat(contentWidth), [contentWidth]);
  const shiftMode = useCallback(() => {
    setRuntime((prev) => {
      const currentIdx = MODE_CYCLE.indexOf(prev.mode);
      const nextMode = MODE_CYCLE[(currentIdx + 1 + MODE_CYCLE.length) % MODE_CYCLE.length] ?? MODE_CYCLE[0];
      setModeIndicator({ mode: nextMode, source: "hotkey", updatedAt: Date.now() });
      return { ...prev, mode: nextMode };
    });
  }, []);
  const closeUserQuestion = useCallback(() => {
    setPendingUserQuestion(null);
    setQuestionFocus("option");
    setSelectedTypeIndex(0);
    setSelectedOptionIndex(0);
  }, []);
  const confirmUserQuestion = useCallback(() => {
    if (!pendingUserQuestion || !pendingQuestionResolveRef.current) {
      return;
    }
    const type = pendingUserQuestion.types[selectedTypeIndex] ?? pendingUserQuestion.types[0] ?? "single_choice";
    const option = pendingUserQuestion.options[selectedOptionIndex] ?? pendingUserQuestion.options[0];
    const answer = {
      type,
      optionId: option?.id ?? "",
      optionLabel: option?.label ?? "",
      question: pendingUserQuestion.question,
      title: pendingUserQuestion.title
    };
    const resolver = pendingQuestionResolveRef.current;
    pendingQuestionResolveRef.current = null;
    closeUserQuestion();
    resolver(answer);
  }, [closeUserQuestion, pendingUserQuestion, selectedOptionIndex, selectedTypeIndex]);
  useEffect(() => {
    const handleResize = () => {
      setTerminalColumns(stdout.columns ?? 80);
    };
    handleResize();
    stdout.on("resize", handleResize);
    return () => {
      stdout.off("resize", handleResize);
    };
  }, [stdout]);
  useEffect(
    () => () => {
      if (streamingFlushTimerRef.current) {
        clearTimeout(streamingFlushTimerRef.current);
      }
    },
    []
  );
  useEffect(() => {
    const persisted = loadSessionToolEvents();
    const existingUserTurns = countUserTurns(history);
    const normalized = persisted.filter((item) => item.turn <= existingUserTurns);
    setToolEvents(normalized);
    if (normalized.length > 0) {
      const maxSeq = normalized.reduce((max, item) => item.seq > max ? item.seq : max, 0);
      const maxTurn = normalized.reduce((max, item) => item.turn > max ? item.turn : max, 0);
      toolSeqRef.current = maxSeq;
      toolTurnRef.current = maxTurn;
    }
    toolEventsHydratedRef.current = true;
  }, []);
  useEffect(() => {
    if (!toolEventsHydratedRef.current) {
      return;
    }
    const existingUserTurns = countUserTurns(history);
    setToolEvents((prev) => prev.filter((item) => item.turn <= existingUserTurns));
  }, [history]);
  useEffect(() => {
    if (!toolEventsHydratedRef.current) {
      return;
    }
    saveSessionToolEvents(toolEvents);
  }, [toolEvents]);
  const setInputAtEnd = useCallback((value) => {
    setInput(value);
    setInputKey((prev) => prev + 1);
  }, []);
  const applySwitchedSession = useCallback(
    (switched) => {
      setHistory(switched.messages);
      const switchedEvents = switched.toolEvents ?? [];
      setToolEvents(switchedEvents);
      toolSeqRef.current = switchedEvents.reduce((max, item) => item.seq > max ? item.seq : max, 0);
      toolTurnRef.current = switchedEvents.reduce((max, item) => item.turn > max ? item.turn : max, 0);
      onHistoryChange?.(switched.messages);
    },
    [onHistoryChange]
  );
  const closeResumePicker = useCallback(() => {
    setResumePickerOpen(false);
    setResumeCandidates([]);
    setResumeCursor(0);
  }, []);
  const memoryPickerItems = useMemo(
    () => [
      { scope: "user", label: "User Memory (Global)" },
      { scope: "project", label: "Project Memory (Current Project)" }
    ],
    []
  );
  const closeMemoryPicker = useCallback(() => {
    setMemoryPickerOpen(false);
    setMemoryPickerCursor(0);
  }, []);
  const openMemoryByScope = useCallback(
    async (scope) => {
      const result = await openMemoryFile(scope, process.cwd());
      if (!result.ok) {
        setError(result.message);
        pushAssistant(`${result.message}
Path: ${result.path}`, setHistory, onHistoryChange);
        return;
      }
      setError(null);
      pushAssistant(`${result.message}
Path: ${result.path}`, setHistory, onHistoryChange);
    },
    [onHistoryChange]
  );
  const confirmMemorySelection = useCallback(() => {
    const selected = memoryPickerItems[memoryPickerCursor];
    if (!selected) {
      return;
    }
    closeMemoryPicker();
    void openMemoryByScope(selected.scope);
  }, [closeMemoryPicker, memoryPickerCursor, memoryPickerItems, openMemoryByScope]);
  const confirmResumeSelection = useCallback(() => {
    const selected = resumeCandidates[resumeCursor];
    if (!selected) {
      return;
    }
    const switched = switchSession(selected.id, process.cwd());
    if (!switched) {
      setError(`Session not found: ${selected.id}`);
      closeResumePicker();
      return;
    }
    applySwitchedSession(switched);
    closeResumePicker();
    pushAssistant(`Resumed session: ${switched.name}`, setHistory, onHistoryChange);
  }, [applySwitchedSession, closeResumePicker, onHistoryChange, resumeCandidates, resumeCursor]);
  const inputSuggestions = useMemo(() => {
    const trimmed = input.trim();
    if (!trimmed.startsWith("/")) {
      return [];
    }
    const optionSuggestions = [
      ...buildOptionSuggestions(input, "/mode ", ["plan", "edit", "auto"], "Select mode"),
      ...buildOptionSuggestions(input, "/theme ", ["black-yellow", "cyber", "minimal"], "Select theme"),
      ...buildOptionSuggestions(
        input,
        "/permissions allow ",
        ["list_files", "read_file", "write_file", "append_file", "patch_file", "delete_file", "search_in_files", "run_shell", "git_status", "git_diff", "git_log"],
        "Allow tool"
      ),
      ...buildOptionSuggestions(
        input,
        "/permissions deny ",
        ["list_files", "read_file", "write_file", "append_file", "patch_file", "delete_file", "search_in_files", "run_shell", "git_status", "git_diff", "git_log"],
        "Deny tool"
      )
    ];
    if (optionSuggestions.length > 0) {
      return optionSuggestions.slice(0, 8);
    }
    const needle = trimmed.toLowerCase();
    return COMMANDS.filter((item) => item.cmd.toLowerCase().startsWith(needle)).map((item) => ({
      label: item.cmd,
      insert: item.complete,
      desc: item.desc,
      kind: "command"
    })).slice(0, 8);
  }, [input]);
  const inlineParamPlaceholder = useMemo(() => getInlineParamPlaceholder(input), [input]);
  useEffect(() => {
    setSuggestionIndex((prev) => {
      if (inputSuggestions.length === 0) {
        return 0;
      }
      return Math.min(prev, inputSuggestions.length - 1);
    });
  }, [inputSuggestions]);
  useInput((inputKey2, key) => {
    if (pendingUserQuestion) {
      if (key.escape) {
        closeUserQuestion();
        setError(null);
        return;
      }
      if (key.tab) {
        setQuestionFocus((prev) => prev === "type" ? "option" : "type");
        return;
      }
      if (questionFocus === "type" && pendingUserQuestion.types.length > 0) {
        if (key.upArrow) {
          setSelectedTypeIndex((prev) => (prev - 1 + pendingUserQuestion.types.length) % pendingUserQuestion.types.length);
          return;
        }
        if (key.downArrow) {
          setSelectedTypeIndex((prev) => (prev + 1) % pendingUserQuestion.types.length);
          return;
        }
      }
      if (questionFocus === "option" && pendingUserQuestion.options.length > 0) {
        if (key.upArrow) {
          setSelectedOptionIndex((prev) => (prev - 1 + pendingUserQuestion.options.length) % pendingUserQuestion.options.length);
          return;
        }
        if (key.downArrow) {
          setSelectedOptionIndex((prev) => (prev + 1) % pendingUserQuestion.options.length);
          return;
        }
      }
      if (key.return) {
        confirmUserQuestion();
        return;
      }
      return;
    }
    if (resumePickerOpen) {
      if (key.escape) {
        closeResumePicker();
        setError(null);
        return;
      }
      if (resumeCandidates.length === 0) {
        return;
      }
      if (key.upArrow) {
        setResumeCursor((prev) => (prev - 1 + resumeCandidates.length) % resumeCandidates.length);
        return;
      }
      if (key.downArrow) {
        setResumeCursor((prev) => (prev + 1) % resumeCandidates.length);
        return;
      }
    }
    if (memoryPickerOpen) {
      if (key.escape) {
        closeMemoryPicker();
        setError(null);
        return;
      }
      if (memoryPickerItems.length === 0) {
        return;
      }
      if (key.upArrow) {
        setMemoryPickerCursor((prev) => (prev - 1 + memoryPickerItems.length) % memoryPickerItems.length);
        return;
      }
      if (key.downArrow) {
        setMemoryPickerCursor((prev) => (prev + 1) % memoryPickerItems.length);
        return;
      }
      if (key.return) {
        confirmMemorySelection();
        return;
      }
    }
    if (key.escape) {
      setInputAtEnd("");
      setError(null);
      return;
    }
    if (key.tab && key.shift) {
      shiftMode();
      setError(null);
      return;
    }
    if (inputSuggestions.length === 0) {
      return;
    }
    if (key.upArrow) {
      setSuggestionIndex((prev) => (prev - 1 + inputSuggestions.length) % inputSuggestions.length);
      return;
    }
    if (key.downArrow) {
      setSuggestionIndex((prev) => (prev + 1) % inputSuggestions.length);
      return;
    }
    if (key.tab) {
      const selected = inputSuggestions[suggestionIndex];
      if (!selected) {
        return;
      }
      const nextInput = selected.kind === "command" ? selected.insert.endsWith(" ") ? selected.insert : `${selected.insert} ` : selected.insert;
      setInputAtEnd(nextInput);
    }
  });
  const runAgentTask = useCallback(
    async (taskPrompt, modeOverride) => {
      const mentionFiles = parseMentionFiles(taskPrompt, process.cwd());
      let enhancedPrompt = taskPrompt;
      if (mentionFiles.length > 0) {
        const inline = mentionFiles.map((file) => {
          const full = path4.resolve(process.cwd(), file);
          const content = fs4.readFileSync(full, "utf8").slice(0, 2e4);
          return `
[FILE: ${file}]
${content}`;
        }).join("\n");
        enhancedPrompt = `${taskPrompt}

Referenced files content:${inline}`;
      }
      const userMessage = { role: "user", content: enhancedPrompt };
      const nextHistory = [...history, userMessage];
      setHistory(nextHistory);
      onHistoryChange?.(nextHistory);
      setLoading(true);
      setStreaming("");
      streamingBufferRef.current = "";
      if (streamingFlushTimerRef.current) {
        clearTimeout(streamingFlushTimerRef.current);
        streamingFlushTimerRef.current = null;
      }
      const currentTurn = nextHistory.filter((item) => item.role === "user").length;
      toolTurnRef.current += 1;
      setToolEvents((prev) => {
        const divider = {
          source: "runtime",
          phase: "start",
          name: `turn_marker_${toolTurnRef.current}`,
          args: { prompt: taskPrompt },
          seq: ++toolSeqRef.current,
          ts: Date.now(),
          turn: currentTurn
        };
        return [...prev.slice(-(MAX_TOOL_EVENTS_STORE - 1)), divider];
      });
      try {
        const mcpTools = mcpManager ? await mcpManager.listTools() : [];
        const memoryPrompt = buildRuntimeMemoryPrompt(process.cwd());
        const mergedAppendPrompt = [runtime.appendSystemPrompt ?? "", memoryPrompt].filter(Boolean).join("\n\n");
        const reply = await agent.chatStream(
          nextHistory,
          {
            mode: modeOverride ?? runtime.mode,
            cwd: process.cwd(),
            enableAudit,
            model: runtime.model,
            fallbackModel: runtime.fallbackModel,
            maxTurns: runtime.maxTurns,
            allowedTools: runtime.allowedTools,
            disallowedTools: runtime.disallowedTools,
            systemPrompt: runtime.systemPrompt,
            appendSystemPrompt: mergedAppendPrompt || void 0,
            mcpTools,
            mcpCall: mcpManager ? (fullName, args) => mcpManager.callTool(fullName, args) : void 0,
            onUserQuestion: (payload) => new Promise((resolve) => {
              const parsed = {
                title: typeof payload.title === "string" ? payload.title : "Need your decision",
                question: typeof payload.question === "string" ? payload.question : "Please choose an option.",
                types: Array.isArray(payload.types) ? payload.types.filter((item) => typeof item === "string" && item.trim().length > 0) : ["single_choice"],
                options: Array.isArray(payload.options) ? payload.options.filter((item) => typeof item === "object" && item !== null).map((item, index) => ({
                  id: typeof item.id === "string" && item.id.trim() ? item.id : `option_${index + 1}`,
                  label: typeof item.label === "string" && item.label.trim() ? item.label : `Option ${index + 1}`,
                  description: typeof item.description === "string" ? item.description : ""
                })) : [
                  { id: "option_1", label: "Proceed with default", description: "Use default path." },
                  { id: "option_2", label: "Need clarification", description: "Ask user for more detail." }
                ],
                defaultType: typeof payload.defaultType === "string" ? payload.defaultType : "",
                defaultOptionId: typeof payload.defaultOptionId === "string" ? payload.defaultOptionId : ""
              };
              const typeIndex = Math.max(0, parsed.types.findIndex((item) => item === parsed.defaultType));
              const optionIndex = Math.max(0, parsed.options.findIndex((item) => item.id === parsed.defaultOptionId));
              setQuestionFocus("option");
              setSelectedTypeIndex(typeIndex);
              setSelectedOptionIndex(optionIndex);
              setPendingUserQuestion(parsed);
              pendingQuestionResolveRef.current = resolve;
            })
          },
          (delta) => {
            streamingBufferRef.current += delta;
            if (!streamingFlushTimerRef.current) {
              streamingFlushTimerRef.current = setTimeout(() => {
                setStreaming(streamingBufferRef.current);
                streamingFlushTimerRef.current = null;
              }, 60);
            }
          },
          (event) => {
            const timelineEvent = {
              ...event,
              seq: ++toolSeqRef.current,
              ts: Date.now(),
              turn: currentTurn
            };
            setToolEvents((prev) => [...prev.slice(-(MAX_TOOL_EVENTS_STORE - 1)), timelineEvent]);
          }
        );
        setHistory((prev) => {
          const assistantMessage = { role: "assistant", content: reply };
          const updated = [...prev, assistantMessage];
          onHistoryChange?.(updated);
          return updated;
        });
        if (streamingFlushTimerRef.current) {
          clearTimeout(streamingFlushTimerRef.current);
          streamingFlushTimerRef.current = null;
        }
        setStreaming(streamingBufferRef.current);
        setStreaming("");
        streamingBufferRef.current = "";
      } catch (err) {
        pendingQuestionResolveRef.current = null;
        closeUserQuestion();
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (streamingFlushTimerRef.current) {
          clearTimeout(streamingFlushTimerRef.current);
          streamingFlushTimerRef.current = null;
        }
        setLoading(false);
      }
    },
    [agent, enableAudit, history, onHistoryChange, runtime]
  );
  const handleSlashCommand = useCallback(
    (content) => {
      if (content === "/help") {
        pushAssistant(HELP_TEXT, setHistory, onHistoryChange);
        return true;
      }
      if (content === "/status") {
        const active = loadActiveSession(process.cwd());
        const status = [
          `mode: ${runtime.mode}`,
          `model: ${runtime.model ?? "(default)"}`,
          `fallback_model: ${runtime.fallbackModel ?? "(none)"}`,
          `max_turns: ${runtime.maxTurns}`,
          `cwd: ${process.cwd()}`,
          `audit: ${enableAudit ? "on" : "off"}`,
          `history_messages: ${history.length}`,
          "tool_details: always",
          `theme: ${theme}`,
          `active_session: ${active.id} (${active.name})`
        ].join("\n");
        pushAssistant(status, setHistory, onHistoryChange);
        return true;
      }
      if (content === "/theme") {
        pushAssistant(
          `Current theme: ${theme}
Available: ${Object.keys(THEME_STYLES).join(", ")}`,
          setHistory,
          onHistoryChange
        );
        return true;
      }
      if (content.startsWith("/theme ")) {
        const next = content.replace("/theme ", "").trim();
        if (!(next in THEME_STYLES)) {
          pushAssistant(`Invalid theme: ${next}
Available: ${Object.keys(THEME_STYLES).join(", ")}`, setHistory, onHistoryChange);
          return true;
        }
        setTheme(next);
        pushAssistant(`Theme switched to: ${next}`, setHistory, onHistoryChange);
        return true;
      }
      if (content === "/config") {
        const payload = {
          configPath: getConfigPath(),
          config: readConfig(),
          runtime
        };
        pushAssistant(JSON.stringify(payload, null, 2), setHistory, onHistoryChange);
        return true;
      }
      if (content === "/context") {
        const info = [
          `message_count: ${history.length}`,
          `last_user: ${[...history].reverse().find((m) => m.role === "user")?.content?.slice(0, 160) ?? "(none)"}`,
          `last_assistant: ${[...history].reverse().find((m) => m.role === "assistant")?.content?.slice(0, 160) ?? "(none)"}`
        ].join("\n");
        pushAssistant(info, setHistory, onHistoryChange);
        return true;
      }
      if (content === "/debug") {
        const debugInfo = {
          runtime,
          commandSuggestions: inputSuggestions.map((item) => item.label),
          activeSession: loadActiveSession(process.cwd()),
          cwd: process.cwd()
        };
        pushAssistant(JSON.stringify(debugInfo, null, 2), setHistory, onHistoryChange);
        return true;
      }
      if (content === "/stats" || content === "/usage") {
        const logs = readRecentAudit(300);
        const byTool = logs.reduce((acc, item) => {
          acc[item.tool] = (acc[item.tool] ?? 0) + 1;
          return acc;
        }, {});
        const summary = {
          totalEvents: logs.length,
          success: logs.filter((x) => x.ok).length,
          failed: logs.filter((x) => !x.ok).length,
          byTool
        };
        pushAssistant(JSON.stringify(summary, null, 2), setHistory, onHistoryChange);
        return true;
      }
      if (content === "/doctor") {
        const checks = [
          `config_exists: ${fs4.existsSync(getConfigPath())}`,
          `policy_exists: ${fs4.existsSync(getPolicyPath(process.cwd()))}`,
          `mcp_exists: ${fs4.existsSync(getMcpConfigPath(process.cwd()))}`,
          `memory_user_exists: ${fs4.existsSync(getMemoryPath())}`,
          `memory_project_exists: ${fs4.existsSync(getProjectMemoryPath(process.cwd()))}`,
          `audit_exists: ${fs4.existsSync(getAuditPath())}`
        ].join("\n");
        pushAssistant(checks, setHistory, onHistoryChange);
        return true;
      }
      if (content === "/new") {
        setHistory([]);
        onHistoryChange?.([]);
        setToolEvents([]);
        toolSeqRef.current = 0;
        toolTurnRef.current = 0;
        pushAssistant("Started a new conversation.", setHistory, onHistoryChange);
        return true;
      }
      if (content === "/compact") {
        setHistory((prev) => {
          const compacted = prev.slice(-6);
          const compactedUserTurns = compacted.filter((item) => item.role === "user").length;
          setToolEvents((prevEvents) => prevEvents.filter((item) => item.turn <= compactedUserTurns));
          onHistoryChange?.(compacted);
          return compacted;
        });
        pushAssistant("Compacted context to latest 6 messages.", setHistory, onHistoryChange);
        return true;
      }
      if (content === "/review") {
        void runAgentTask(
          "Please review the current repository changes. Use git_status and git_diff tools first, then provide: summary, potential bugs, security risks, and actionable fixes.",
          "plan"
        );
        return true;
      }
      if (content === "/plan") {
        void runAgentTask(
          "Please produce a concrete implementation plan for the current task. Focus on ordered steps, risks, and validation strategy.",
          "plan"
        );
        return true;
      }
      if (content.startsWith("/test")) {
        const custom = content.replace("/test", "").trim();
        const testPrompt = custom ? `Run this test command with tools: ${custom}. Summarize failures and likely root cause.` : "Detect and run the most appropriate test command for this project using tools. Summarize failures and likely root cause.";
        void runAgentTask(testPrompt, "auto");
        return true;
      }
      if (content === "/fix") {
        void runAgentTask(
          "Investigate current project issues using available tools, implement a minimal fix, and explain what was changed and why.",
          "auto"
        );
        return true;
      }
      if (content === "/tasks") {
        void runAgentTask("List pending implementation tasks with priorities and next action.", "plan");
        return true;
      }
      if (content === "/todos") {
        void runAgentTask("Generate concise TODO checklist using markdown task items.", "plan");
        return true;
      }
      if (content === "/copy") {
        const latest = [...history].reverse().find((item) => item.role === "assistant")?.content;
        if (!latest) {
          pushAssistant("No assistant message to copy.", setHistory, onHistoryChange);
          return true;
        }
        void (async () => {
          try {
            const mod = await import("clipboardy");
            await mod.write(latest);
            pushAssistant("Copied latest assistant response to clipboard.", setHistory, onHistoryChange);
          } catch {
            pushAssistant("Clipboard unavailable in this environment.", setHistory, onHistoryChange);
          }
        })();
        return true;
      }
      if (content === "/init") {
        const info = [
          `config: ${getConfigPath()}`,
          `policy: ${getPolicyPath(process.cwd())}`,
          `mcp: ${getMcpConfigPath(process.cwd())}`,
          `memory_user: ${getMemoryPath()}`,
          `memory_project: ${getProjectMemoryPath(process.cwd())}`,
          `audit: ${getAuditPath()}`,
          `approvals: ${getApprovalPath()}`
        ].join("\n");
        pushAssistant(info, setHistory, onHistoryChange);
        return true;
      }
      if (content === "/clear") {
        setHistory([]);
        onHistoryChange?.([]);
        return true;
      }
      if (content === "/audit") {
        const logs = readRecentAudit(8);
        const summary = logs.length ? logs.map((item) => `${item.timestamp} [${item.mode}] ${item.tool} ${item.ok ? "OK" : "FAIL"} ${item.summary}`).join("\n") : `No audit logs. Path: ${getAuditPath()}`;
        pushAssistant(summary, setHistory, onHistoryChange);
        return true;
      }
      if (content === "/memory") {
        setMemoryPickerOpen(true);
        setMemoryPickerCursor(0);
        setError(null);
        setInput("");
        return true;
      }
      if (content.startsWith("/memory ")) {
        const args = content.replace("/memory ", "").trim().split(/\s+/).filter(Boolean);
        const scope = parseMemoryScope((args[0] ?? "").toLowerCase());
        if (!scope) {
          pushAssistant("Usage:\n/memory\n/memory user\n/memory project", setHistory, onHistoryChange);
          return true;
        }
        ensureMemoryFile(scope, process.cwd());
        void openMemoryByScope(scope);
        return true;
      }
      if (content === "/mcp") {
        const mcp = loadMcpConfig(process.cwd());
        const toolsPromise = mcpManager ? mcpManager.listTools() : Promise.resolve([]);
        void toolsPromise.then((tools) => {
          pushAssistant(
            JSON.stringify(
              {
                config: mcp,
                discoveredTools: tools.map((item) => item.fullName)
              },
              null,
              2
            ),
            setHistory,
            onHistoryChange
          );
        });
        return true;
      }
      if (content === "/mcp init") {
        const p = initMcpConfig(process.cwd());
        pushAssistant(`MCP config initialized: ${p}`, setHistory, onHistoryChange);
        return true;
      }
      if (content.startsWith("/agents")) {
        const base = content.replace("/agents", "").trim();
        const prompt = base || "analyze current project and propose concrete implementation steps";
        void (async () => {
          const runtimeAgent = new MultiAgentRuntime(agent);
          const results = await runtimeAgent.runTasks(
            [{ role: "user", content: prompt }],
            [
              {
                name: "planner",
                mode: "plan",
                prompt: "Create a detailed implementation plan with risks."
              },
              {
                name: "coder",
                mode: "edit",
                prompt: "Provide concrete code-level changes to implement the request."
              },
              {
                name: "reviewer",
                mode: "plan",
                prompt: "Review the proposed approach and list potential issues."
              }
            ],
            {
              cwd: process.cwd(),
              enableAudit,
              maxTurns: runtime.maxTurns
            }
          );
          pushAssistant(MultiAgentRuntime.formatResults(results), setHistory, onHistoryChange);
        })();
        return true;
      }
      if (content.startsWith("/model")) {
        const next = content.replace("/model", "").trim();
        if (!next) {
          pushAssistant(`Current model: ${runtime.model ?? "(default from config)"}`, setHistory, onHistoryChange);
        } else {
          setRuntime((prev) => ({ ...prev, model: next }));
          pushAssistant(`Model set to: ${next}`, setHistory, onHistoryChange);
        }
        return true;
      }
      if (content.startsWith("/mode ")) {
        const next = content.replace("/mode ", "").trim();
        if (SUPPORTED_MODES.includes(next)) {
          setRuntime((prev) => ({ ...prev, mode: next }));
          setModeIndicator({ mode: next, source: "command", updatedAt: Date.now() });
          setError(null);
        } else {
          setError(`Invalid mode: ${next}. Allowed: ${SUPPORTED_MODES.join(", ")}`);
        }
        return true;
      }
      if (content === "/permissions") {
        const payload = {
          allowedTools: runtime.allowedTools,
          disallowedTools: runtime.disallowedTools
        };
        pushAssistant(JSON.stringify(payload, null, 2), setHistory, onHistoryChange);
        return true;
      }
      if (content.startsWith("/permissions allow ")) {
        const tool = content.replace("/permissions allow ", "").trim();
        if (tool) {
          setRuntime((prev) => ({
            ...prev,
            allowedTools: [.../* @__PURE__ */ new Set([...prev.allowedTools, tool])],
            disallowedTools: prev.disallowedTools.filter((item) => item !== tool)
          }));
          pushAssistant(`Allowed tool: ${tool}`, setHistory, onHistoryChange);
        }
        return true;
      }
      if (content.startsWith("/permissions deny ")) {
        const tool = content.replace("/permissions deny ", "").trim();
        if (tool) {
          setRuntime((prev) => ({
            ...prev,
            disallowedTools: [.../* @__PURE__ */ new Set([...prev.disallowedTools, tool])],
            allowedTools: prev.allowedTools.filter((item) => item !== tool)
          }));
          pushAssistant(`Denied tool: ${tool}`, setHistory, onHistoryChange);
        }
        return true;
      }
      if (content === "/permissions clear") {
        setRuntime((prev) => ({ ...prev, allowedTools: [], disallowedTools: [] }));
        pushAssistant("Cleared tool allow/deny lists.", setHistory, onHistoryChange);
        return true;
      }
      if (content === "/resume") {
        const sessions = listSessions(process.cwd());
        if (sessions.length === 0) {
          pushAssistant("No sessions available.", setHistory, onHistoryChange);
          return true;
        }
        setResumeCandidates(sessions);
        setResumeCursor(0);
        setResumePickerOpen(true);
        setError(null);
        setInput("");
        return true;
      }
      if (content.startsWith("/resume ")) {
        pushAssistant("Usage: /resume (no id needed). Pick one from the list.", setHistory, onHistoryChange);
        return true;
      }
      if (content.startsWith("/rewind ")) {
        const n = Number.parseInt(content.replace("/rewind ", "").trim(), 10);
        const rewound = rewindActiveSession(Number.isFinite(n) ? n : 1, process.cwd());
        setHistory(rewound.messages);
        setToolEvents(rewound.toolEvents ?? []);
        onHistoryChange?.(rewound.messages);
        pushAssistant(`Rewound session by ${Number.isFinite(n) ? n : 1} messages.`, setHistory, onHistoryChange);
        return true;
      }
      if (content.startsWith("/rename ")) {
        const next = content.replace("/rename ", "").trim();
        const renamed = renameActiveSession(next, process.cwd());
        pushAssistant(`Renamed session to: ${renamed.name}`, setHistory, onHistoryChange);
        return true;
      }
      if (content.startsWith("/export")) {
        const target = content.replace("/export", "").trim();
        const outputPath = target || path4.join(process.cwd(), "happycode-export.md");
        const body = history.map((item) => `## ${item.role.toUpperCase()}

${item.content}`).join("\n\n");
        fs4.writeFileSync(outputPath, `${body}
`, "utf8");
        pushAssistant(`Exported conversation to: ${outputPath}`, setHistory, onHistoryChange);
        return true;
      }
      if (content === "/approvals") {
        const list = getApprovalPrefixes();
        const msg = list.length ? `Approval prefixes:
${list.map((s) => `- ${s}`).join("\n")}` : `No session approvals. Path: ${getApprovalPath()}`;
        pushAssistant(msg, setHistory, onHistoryChange);
        return true;
      }
      if (content === "/approvals clear") {
        clearCommandApprovals();
        pushAssistant("Cleared saved command approvals.", setHistory, onHistoryChange);
        return true;
      }
      if (content.startsWith("/allow once ")) {
        const cmd = content.replace("/allow once ", "").trim();
        const prefix = cmd.split(" ").slice(0, 2).join(" ").trim() || cmd;
        allowCommandPrefix(prefix);
        pushAssistant(`Approved once-like prefix: ${prefix}. You can now retry.`, setHistory, onHistoryChange);
        return true;
      }
      if (content.startsWith("/allow session ")) {
        const prefix = content.replace("/allow session ", "").trim();
        if (!prefix) {
          setError("Usage: /allow session <command-prefix>");
        } else {
          allowCommandPrefix(prefix);
          pushAssistant(`Approved session prefix: ${prefix}`, setHistory, onHistoryChange);
        }
        return true;
      }
      if (content === "/policy init") {
        const p = writeDefaultPolicy(process.cwd());
        pushAssistant(`Policy initialized at: ${p}`, setHistory, onHistoryChange);
        return true;
      }
      if (content === "/policy path") {
        const p = getPolicyPath(process.cwd());
        pushAssistant(`Policy path: ${p}`, setHistory, onHistoryChange);
        return true;
      }
      return false;
    },
    [
      inputSuggestions,
      applySwitchedSession,
      closeResumePicker,
      enableAudit,
      history,
      onHistoryChange,
      runAgentTask,
      openMemoryByScope,
      runtime
    ]
  );
  const submit = useCallback(async () => {
    if (pendingUserQuestion) {
      confirmUserQuestion();
      return;
    }
    if (resumePickerOpen) {
      confirmResumeSelection();
      return;
    }
    if (memoryPickerOpen) {
      confirmMemorySelection();
      return;
    }
    const content = input.trim();
    if (!content || loading) {
      return;
    }
    if (content === "/" && inputSuggestions.length > 0) {
      const selected = inputSuggestions[suggestionIndex];
      if (selected) {
        const completion = selected.insert;
        if (completion.endsWith(" ")) {
          setInputAtEnd(completion);
          return;
        }
        const handled = handleSlashCommand(completion.trim());
        if (!handled) {
          pushAssistant(`Unknown command: ${completion.trim()}
Use /help`, setHistory, onHistoryChange);
        }
        setInput("");
        return;
      }
    }
    if (content === "/exit" || content === "/quit") {
      exit();
      return;
    }
    if (content.startsWith("!")) {
      const cmd = content.slice(1).trim();
      if (!cmd) {
        setError("Usage: !<shell command>");
        return;
      }
      await runAgentTask(`Run shell command and summarize result: ${cmd}`, "auto");
      setInput("");
      return;
    }
    setError(null);
    setInput("");
    if (content.startsWith("/")) {
      const handled = handleSlashCommand(content);
      if (!handled) {
        pushAssistant(`Unknown command: ${content}
Use /help`, setHistory, onHistoryChange);
      }
      return;
    }
    await runAgentTask(content);
  }, [
    inputSuggestions,
    exit,
    handleSlashCommand,
    input,
    loading,
    onHistoryChange,
    runAgentTask,
    confirmResumeSelection,
    confirmMemorySelection,
    confirmUserQuestion,
    setInputAtEnd,
    suggestionIndex,
    resumePickerOpen,
    memoryPickerOpen,
    pendingUserQuestion
  ]);
  const visibleResumeCandidates = useMemo(() => {
    if (!resumePickerOpen) {
      return [];
    }
    const maxItems = 10;
    if (resumeCandidates.length <= maxItems) {
      return resumeCandidates;
    }
    const start = Math.max(0, Math.min(resumeCursor - Math.floor(maxItems / 2), resumeCandidates.length - maxItems));
    return resumeCandidates.slice(start, start + maxItems);
  }, [resumeCandidates, resumeCursor, resumePickerOpen]);
  const toolTimeline = useMemo(() => {
    return [...toolEvents].sort((a, b) => {
      if (a.ts === b.ts) {
        return a.seq - b.seq;
      }
      return a.ts - b.ts;
    });
  }, [toolEvents]);
  const visibleTimeline = useMemo(
    () => toolTimeline.filter((event) => event.source === "model" && !event.name.startsWith("turn_marker_")),
    [toolTimeline]
  );
  const activeToolNames = useMemo(() => {
    const active = [];
    for (const event of visibleTimeline) {
      if (event.phase === "start") {
        active.push(event.name);
      } else {
        const idx = active.indexOf(event.name);
        if (idx >= 0) {
          active.splice(idx, 1);
        }
      }
    }
    return active;
  }, [visibleTimeline]);
  const toolSteps = useMemo(() => {
    const steps = [];
    const runningByName = /* @__PURE__ */ new Map();
    for (const event of visibleTimeline) {
      if (event.phase === "start") {
        const stepIndex2 = steps.push({
          id: event.seq,
          turn: event.turn,
          name: event.name,
          args: event.args,
          status: "running"
        }) - 1;
        const queue2 = runningByName.get(event.name) ?? [];
        queue2.push(stepIndex2);
        runningByName.set(event.name, queue2);
        continue;
      }
      const queue = runningByName.get(event.name) ?? [];
      const stepIndex = queue.shift();
      if (stepIndex === void 0) {
        continue;
      }
      runningByName.set(event.name, queue);
      const current = steps[stepIndex];
      if (!current) {
        continue;
      }
      current.status = event.ok ? "done" : "failed";
      current.preview = event.preview;
      current.endedAt = event.ts;
    }
    return steps;
  }, [visibleTimeline]);
  const toolStepsByTurn = useMemo(() => {
    const grouped = /* @__PURE__ */ new Map();
    for (const step of toolSteps) {
      const bucket = grouped.get(step.turn) ?? [];
      bucket.push(step);
      grouped.set(step.turn, bucket);
    }
    return grouped;
  }, [toolSteps]);
  const conversationFlow = useMemo(() => {
    const rows = [];
    let turn = 0;
    const visibleMessages = history.filter((item) => item.role !== "system");
    for (let idx = 0; idx < visibleMessages.length; idx += 1) {
      const item = visibleMessages[idx];
      if (item.role === "system") {
        continue;
      }
      if (item.role === "user") {
        turn += 1;
      }
      rows.push({
        kind: "message",
        key: `msg-${idx}`,
        role: item.role,
        content: item.content
      });
      if (item.role === "user") {
        const turnSteps = toolStepsByTurn.get(turn) ?? [];
        for (const step of turnSteps) {
          rows.push({
            kind: "tool",
            key: `tool-step-${step.id}`,
            step
          });
        }
      }
    }
    return rows.slice(-MAX_RENDER_FLOW_ITEMS);
  }, [history, toolStepsByTurn]);
  return /* @__PURE__ */ jsxs(Box, { flexDirection: "column", padding: 1, children: [
    /* @__PURE__ */ jsxs(Box, { borderStyle: "round", borderColor: themeStyle.titleColor, paddingX: 1, flexDirection: "column", width: contentWidth, children: [
      /* @__PURE__ */ jsx(Text, { color: themeStyle.titleColor, children: ":) HappyCode" }),
      /* @__PURE__ */ jsxs(Text, { color: themeStyle.metaColor, children: [
        "Project: ",
        projectName
      ] }),
      /* @__PURE__ */ jsxs(Text, { color: themeStyle.metaColor, children: [
        "Mode: ",
        runtime.mode
      ] }),
      runtime.mode === "plan" ? /* @__PURE__ */ jsx(Text, { color: "yellow", children: "PLAN MODE ACTIVE" }) : null,
      /* @__PURE__ */ jsxs(Text, { color: themeStyle.metaColor, children: [
        "Model: ",
        runtime.model ?? "(default)"
      ] }),
      /* @__PURE__ */ jsxs(Text, { color: themeStyle.metaColor, children: [
        "Version: ",
        appVersion
      ] })
    ] }),
    /* @__PURE__ */ jsxs(Box, { marginTop: 1, flexDirection: "column", width: contentWidth, children: [
      conversationFlow.map((row) => {
        if (row.kind === "message") {
          return /* @__PURE__ */ jsxs(Box, { flexDirection: "column", width: contentWidth, children: [
            /* @__PURE__ */ jsx(Text, { color: row.role === "user" ? "cyan" : "white", children: row.content.replace(/\r\n/g, "\n") }),
            /* @__PURE__ */ jsx(Text, { color: "gray", children: flowSeparator })
          ] }, row.key);
        }
        const step = row.step;
        const effectiveStatus = step.status === "running" && !loading ? "interrupted" : step.status;
        const statusColor = effectiveStatus === "running" ? "blue" : effectiveStatus === "done" ? "green" : effectiveStatus === "interrupted" ? "yellow" : "red";
        const badge = getResultTypeBadge(step);
        const runningDetail = `Args: ${JSON.stringify(step.args)}`;
        const finishedDetail = `Result: ${step.preview ?? "(no output)"}`;
        const baseDetail = effectiveStatus === "running" ? runningDetail : finishedDetail;
        return /* @__PURE__ */ jsxs(Box, { flexDirection: "column", width: contentWidth, children: [
          /* @__PURE__ */ jsxs(Box, { borderStyle: "round", borderColor: statusColor, paddingX: 1, flexDirection: "column", children: [
            /* @__PURE__ */ jsxs(Box, { children: [
              /* @__PURE__ */ jsx(Text, { color: statusColor, children: effectiveStatus === "running" ? "Running tool" : effectiveStatus === "done" ? "Tool completed" : effectiveStatus === "interrupted" ? "Tool interrupted" : "Tool failed" }),
              /* @__PURE__ */ jsxs(Text, { color: getToolTagColor(step.name), children: [
                " [",
                formatToolTag(step.name),
                "]"
              ] }),
              /* @__PURE__ */ jsxs(Text, { color: "gray", children: [
                " ",
                badge.icon,
                " ",
                badge.label
              ] })
            ] }),
            /* @__PURE__ */ jsx(Text, { color: "gray", children: toPreviewText(baseDetail, 10, 1200) })
          ] }),
          /* @__PURE__ */ jsx(Text, { color: "gray", children: flowSeparator })
        ] }, row.key);
      }),
      loading && streaming ? /* @__PURE__ */ jsxs(Box, { flexDirection: "column", width: contentWidth, children: [
        /* @__PURE__ */ jsx(Text, { children: streaming.replace(/\r\n/g, "\n") }),
        /* @__PURE__ */ jsx(Text, { color: "gray", children: flowSeparator })
      ] }) : null
    ] }),
    loading ? /* @__PURE__ */ jsx(Box, { marginTop: 1, children: /* @__PURE__ */ jsx(Text, { color: "yellow", children: "Thinking..." }) }) : null,
    error ? /* @__PURE__ */ jsx(Box, { marginTop: 1, children: /* @__PURE__ */ jsxs(Text, { color: "red", children: [
      "Error: ",
      error
    ] }) }) : null,
    /* @__PURE__ */ jsxs(Box, { marginTop: 1, flexDirection: "column", width: contentWidth, children: [
      /* @__PURE__ */ jsx(Text, { color: "gray", children: flowSeparator }),
      /* @__PURE__ */ jsxs(Box, { children: [
        /* @__PURE__ */ jsx(Text, { color: "green", children: ">" }),
        /* @__PURE__ */ jsx(TextInput, { value: input, onChange: setInput, onSubmit: submit }, inputKey),
        inlineParamPlaceholder ? /* @__PURE__ */ jsx(Text, { color: "gray", children: inlineParamPlaceholder }) : null
      ] }),
      /* @__PURE__ */ jsx(Text, { color: "yellow", children: modeIndicator.source === "init" ? `Current mode: ${modeIndicator.mode}` : `Mode switched (${modeIndicator.source === "hotkey" ? "Shift+Tab" : "/mode"}): ${modeIndicator.mode}` })
    ] }),
    inputSuggestions.length > 0 ? /* @__PURE__ */ jsxs(Box, { flexDirection: "column", children: [
      /* @__PURE__ */ jsx(Text, { color: "white", children: "Command Hints" }),
      inputSuggestions.map((item, idx) => /* @__PURE__ */ jsxs(Text, { color: idx === suggestionIndex ? "cyan" : "white", children: [
        item.label,
        " - ",
        item.desc
      ] }, item.label))
    ] }) : null,
    pendingUserQuestion ? /* @__PURE__ */ jsxs(Box, { flexDirection: "column", borderStyle: "round", borderColor: "yellow", paddingX: 1, marginTop: 1, width: contentWidth, children: [
      /* @__PURE__ */ jsx(Text, { color: "yellow", children: "User Question Required" }),
      /* @__PURE__ */ jsx(Text, { children: pendingUserQuestion.title }),
      /* @__PURE__ */ jsx(Text, { color: "gray", children: pendingUserQuestion.question }),
      /* @__PURE__ */ jsxs(Text, { color: questionFocus === "type" ? "cyan" : "white", children: [
        "Types: ",
        pendingUserQuestion.types.map((item, idx) => idx === selectedTypeIndex ? `[${item}]` : item).join("  ")
      ] }),
      pendingUserQuestion.options.map((item, idx) => /* @__PURE__ */ jsxs(Text, { color: questionFocus === "option" && idx === selectedOptionIndex ? "cyan" : "white", children: [
        idx === selectedOptionIndex ? ">" : " ",
        " ",
        item.label,
        item.description ? ` - ${item.description}` : ""
      ] }, item.id)),
      /* @__PURE__ */ jsx(Text, { color: "gray", children: "Tab switch focus, \u2191/\u2193 choose, Enter confirm" })
    ] }) : null,
    resumePickerOpen ? /* @__PURE__ */ jsxs(Box, { marginTop: 1, flexDirection: "column", width: contentWidth, children: [
      /* @__PURE__ */ jsx(Text, { color: "white", children: "Resume Sessions (\u2191/\u2193 choose, Enter confirm, Esc cancel)" }),
      visibleResumeCandidates.map((item) => {
        const selected = resumeCandidates[resumeCursor]?.id === item.id;
        const absoluteEditedAt = formatAbsoluteTime(item.updatedAt);
        const relativeEditedAt = formatRelativeTime(item.updatedAt);
        return /* @__PURE__ */ jsxs(Text, { color: selected ? "cyan" : "white", children: [
          selected ? ">" : " ",
          " ",
          item.name,
          " last:",
          absoluteEditedAt,
          " (",
          relativeEditedAt,
          ") msgs:",
          item.messages.length
        ] }, item.id);
      })
    ] }) : null,
    memoryPickerOpen ? /* @__PURE__ */ jsxs(Box, { marginTop: 1, flexDirection: "column", width: contentWidth, children: [
      /* @__PURE__ */ jsx(Text, { color: "white", children: "Memory Files (\u2191/\u2193 choose, Enter open, Esc cancel)" }),
      memoryPickerItems.map((item, idx) => {
        const selected = idx === memoryPickerCursor;
        return /* @__PURE__ */ jsxs(Text, { color: selected ? "cyan" : "white", children: [
          selected ? ">" : " ",
          " ",
          item.label
        ] }, item.scope);
      })
    ] }) : null
  ] });
}

// src/cli.ts
var program = new Command();
program.name("happycode").description("Coding-focused TUI for OpenAI-compatible APIs").version("0.1.0");
program.command("init").description("Save base URL and API key").requiredOption("--base-url <url>", "OpenAI-compatible base URL, e.g. https://api.openai.com/v1").requiredOption("--api-key <key>", "API key").option("--model <model>", "Model name", "gpt-4o-mini").action((options) => {
  writeConfig({
    baseUrl: options.baseUrl,
    apiKey: options.apiKey,
    model: options.model
  });
  process.stdout.write(`Saved config to ${getConfigPath()}
`);
});
program.command("run").description("Start TUI").option("--mode <mode>", `Default mode: ${SUPPORTED_MODES.join("|")}`, "auto").option("--model <name>", "Override model").option("--fallback-model <name>", "Fallback model on failure").option("--max-turns <n>", "Max tool turns", "8").option("--allowed-tools <csv>", "Comma separated allowed tools").option("--disallowed-tools <csv>", "Comma separated disallowed tools").option("--system-prompt <text>", "Override system prompt").option("--append-system-prompt <text>", "Append additional system prompt text").option("--resume <sessionId>", "Resume by session id").option("--new [name]", "Start a fresh session").option("--no-audit", "Disable tool audit log").action((options) => {
  const cfg = readConfig();
  if (!cfg) {
    process.stderr.write(
      "Config not found. Run:\n  happycode init --base-url <url> --api-key <key> [--model <model>]\n"
    );
    process.exit(1);
  }
  const mode = options.mode ?? "auto";
  if (!SUPPORTED_MODES.includes(mode)) {
    process.stderr.write(`Invalid mode: ${mode}. Allowed: ${SUPPORTED_MODES.join(", ")}
`);
    process.exit(1);
  }
  if (options.resume) {
    const restored = switchSession(String(options.resume), process.cwd());
    if (!restored) {
      process.stderr.write(`Session not found: ${options.resume}
`);
      process.exit(1);
    }
  } else {
    const nextName = typeof options.new === "string" ? options.new : "new";
    createSession(nextName, process.cwd());
  }
  const agent = new HappyCodeAgent(cfg);
  const mcpManager = new McpClientManager();
  const mcpConfig = loadMcpConfig(process.cwd());
  void mcpManager.ensureServers(mcpConfig);
  const active = loadActiveSession(process.cwd());
  const maxTurns = Number.parseInt(String(options.maxTurns), 10);
  const allowedTools = String(options.allowedTools ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  const disallowedTools = String(options.disallowedTools ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  render(
    React2.createElement(App, {
      agent,
      appVersion: program.version(),
      defaultMode: mode,
      defaultModel: options.model,
      defaultRuntime: {
        mode,
        model: options.model,
        fallbackModel: options.fallbackModel,
        maxTurns: Number.isFinite(maxTurns) ? maxTurns : 8,
        allowedTools,
        disallowedTools,
        systemPrompt: options.systemPrompt,
        appendSystemPrompt: options.appendSystemPrompt
      },
      mcpManager,
      enableAudit: options.audit !== false,
      initialHistory: active.messages,
      onHistoryChange: (messages) => saveSessionMessages(messages, process.cwd())
    })
  );
});
program.command("chat").description("Single-turn non-interactive chat").requiredOption("-m, --message <text>", "User message").option("--mode <mode>", `Mode: ${SUPPORTED_MODES.join("|")}`, "plan").option("--model <name>", "Override model").option("--fallback-model <name>", "Fallback model on failure").option("--max-turns <n>", "Max tool turns", "8").option("--allowed-tools <csv>", "Comma separated allowed tools").option("--disallowed-tools <csv>", "Comma separated disallowed tools").option("--system-prompt <text>", "Override system prompt").option("--append-system-prompt <text>", "Append additional system prompt text").option("--json", "Print JSON output").option("--stream-json", "Stream JSON chunks").option("--no-audit", "Disable tool audit log").action(async (options) => {
  const cfg = readConfig();
  if (!cfg) {
    process.stderr.write(
      "Config not found. Run:\n  happycode init --base-url <url> --api-key <key> [--model <model>]\n"
    );
    process.exit(1);
  }
  const mode = options.mode ?? "plan";
  if (!SUPPORTED_MODES.includes(mode)) {
    process.stderr.write(`Invalid mode: ${mode}. Allowed: ${SUPPORTED_MODES.join(", ")}
`);
    process.exit(1);
  }
  const agent = new HappyCodeAgent(cfg);
  const mcpManager = new McpClientManager();
  const mcpConfig = loadMcpConfig(process.cwd());
  await mcpManager.ensureServers(mcpConfig);
  const mcpTools = await mcpManager.listTools();
  const maxTurns = Number.parseInt(String(options.maxTurns), 10);
  const allowedTools = String(options.allowedTools ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  const disallowedTools = String(options.disallowedTools ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  const chunks = [];
  const result = await agent.chatStream(
    [{ role: "user", content: options.message }],
    {
      mode,
      cwd: process.cwd(),
      model: options.model,
      fallbackModel: options.fallbackModel,
      maxTurns: Number.isFinite(maxTurns) ? maxTurns : 8,
      allowedTools,
      disallowedTools,
      systemPrompt: options.systemPrompt,
      appendSystemPrompt: [options.appendSystemPrompt ?? "", buildRuntimeMemoryPrompt(process.cwd())].filter(Boolean).join("\n\n") || void 0,
      mcpTools,
      mcpCall: (fullName, args) => mcpManager.callTool(fullName, args),
      enableAudit: options.audit !== false
    },
    (delta) => {
      chunks.push(delta);
      if (options.streamJson) {
        process.stdout.write(`${JSON.stringify({ type: "delta", content: delta })}
`);
      } else if (!options.json) {
        process.stdout.write(delta);
      }
    },
    (event) => {
      if (options.streamJson) {
        process.stdout.write(`${JSON.stringify({ type: "tool", event })}
`);
      } else {
        const marker = event.phase === "start" ? "TOOL>" : "TOOL<";
        const info = event.phase === "start" ? JSON.stringify(event.args) : `${event.ok ? "ok" : "fail"} ${event.preview ?? ""}`;
        process.stderr.write(`${marker} ${event.name} ${info}
`);
      }
    }
  );
  if (options.json) {
    process.stdout.write(
      `${JSON.stringify({
        mode,
        message: options.message,
        output: result,
        chunks
      }, null, 2)}
`
    );
  } else if (!options.streamJson && !result.endsWith("\n")) {
    process.stdout.write("\n");
  }
  await mcpManager.shutdown();
});
program.command("agents").description("Run multi-agent orchestration tasks").requiredOption("-m, --message <text>", "Base user prompt").action(async (options) => {
  const cfg = readConfig();
  if (!cfg) {
    process.stderr.write(
      "Config not found. Run:\n  happycode init --base-url <url> --api-key <key> [--model <model>]\n"
    );
    process.exit(1);
  }
  const agent = new HappyCodeAgent(cfg);
  const runtime = new MultiAgentRuntime(agent);
  const results = await runtime.runTasks(
    [{ role: "user", content: options.message }],
    [
      {
        name: "planner",
        mode: "plan",
        prompt: "Create a detailed implementation plan with risks."
      },
      {
        name: "coder",
        mode: "edit",
        prompt: "Provide concrete code-level changes to implement the request."
      },
      {
        name: "reviewer",
        mode: "plan",
        prompt: "Review the proposed approach and list potential issues."
      }
    ],
    {
      cwd: process.cwd(),
      enableAudit: true,
      maxTurns: 5
    }
  );
  process.stdout.write(`${MultiAgentRuntime.formatResults(results)}
`);
});
program.command("session").description("Session helpers").option("--clear", "Clear active session messages").option("--root", "Print sessions root path").option("--legacy-path", "Print legacy session file path").option("--list", "List sessions").option("--new [name]", "Create and switch to new session").option("--resume <id>", "Switch active session by id").option("--rename <name>", "Rename current session").option("--fork [name]", "Fork current session and switch").option("--rewind <steps>", "Drop last N messages from current session").action((options) => {
  if (options.root) {
    process.stdout.write(`${getSessionRootPath()}
`);
    return;
  }
  if (options.legacyPath) {
    process.stdout.write(`${getLegacySessionPath()}
`);
    return;
  }
  if (options.list) {
    process.stdout.write(`${JSON.stringify(listSessions(process.cwd()), null, 2)}
`);
    return;
  }
  if (options.new) {
    const created = createSession(typeof options.new === "string" ? options.new : "new", process.cwd());
    process.stdout.write(`${JSON.stringify(created, null, 2)}
`);
    return;
  }
  if (options.resume) {
    const resumed = switchSession(String(options.resume), process.cwd());
    if (!resumed) {
      process.stderr.write(`Session not found: ${options.resume}
`);
      process.exit(1);
    }
    process.stdout.write(`${JSON.stringify(resumed, null, 2)}
`);
    return;
  }
  if (options.rename) {
    const renamed = renameActiveSession(String(options.rename), process.cwd());
    process.stdout.write(`${JSON.stringify(renamed, null, 2)}
`);
    return;
  }
  if (options.fork) {
    const forked = forkActiveSession(typeof options.fork === "string" ? options.fork : void 0, process.cwd());
    process.stdout.write(`${JSON.stringify(forked, null, 2)}
`);
    return;
  }
  if (options.rewind) {
    const steps = Number.parseInt(String(options.rewind), 10);
    const rewound = rewindActiveSession(Number.isFinite(steps) ? steps : 1, process.cwd());
    process.stdout.write(`${JSON.stringify(rewound, null, 2)}
`);
    return;
  }
  if (options.clear) {
    clearSession(process.cwd());
    process.stdout.write("Active session cleared.\n");
    return;
  }
  process.stdout.write(
    `${JSON.stringify({
      active: loadActiveSession(process.cwd()),
      messages: loadSessionMessages(process.cwd()).length
    }, null, 2)}
`
  );
});
program.command("audit").description("Audit log helpers").option("--path", "Print audit log path").option("--tail <n>", "Print latest n audit records", "20").action((options) => {
  if (options.path) {
    process.stdout.write(`${getAuditPath()}
`);
    return;
  }
  const n = Number.parseInt(String(options.tail), 10);
  const records = readRecentAudit(Number.isFinite(n) ? n : 20);
  if (records.length === 0) {
    process.stdout.write("No audit records found.\n");
    return;
  }
  process.stdout.write(`${JSON.stringify(records, null, 2)}
`);
});
program.command("policy").description("Policy file helpers").option("--path", "Print policy file path").option("--init", "Create default policy file if missing").action((options) => {
  if (options.path) {
    process.stdout.write(`${getPolicyPath(process.cwd())}
`);
    return;
  }
  if (options.init) {
    const p = writeDefaultPolicy(process.cwd());
    process.stdout.write(`Policy ready: ${p}
`);
    return;
  }
  process.stdout.write("Use --path or --init\n");
});
program.command("approvals").description("Command approval helpers").option("--path", "Print approvals storage path").option("--list", "List approved prefixes").option("--clear", "Clear approved prefixes").action((options) => {
  if (options.path) {
    process.stdout.write(`${getApprovalPath()}
`);
    return;
  }
  if (options.list) {
    process.stdout.write(`${JSON.stringify(getApprovalPrefixes(), null, 2)}
`);
    return;
  }
  if (options.clear) {
    clearCommandApprovals();
    process.stdout.write("Cleared approvals.\n");
    return;
  }
  process.stdout.write("Use --path, --list, or --clear\n");
});
if (process.argv.length === 2) {
  process.argv.push("run");
}
program.parse();
