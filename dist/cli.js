#!/usr/bin/env node
import {
  HappyCodeAgent,
  SUPPORTED_MODES,
  allowGlobalCommandPrefix,
  appendInputHistoryEntry,
  approveCommandForSession,
  approveCommandOnce,
  bindPlanToActiveSession,
  buildRuntimeMemoryPrompt,
  clearActiveSessionPlanBinding,
  clearGlobalCommandApprovals,
  clearSession,
  clearSessionApprovals,
  createSession,
  ensureMemoryFile,
  forkActiveSession,
  getApprovalPath,
  getAuditPath,
  getConfigPath,
  getGlobalApprovalPrefixes,
  getGlobalPolicyPath,
  getInputHistory,
  getLegacySessionPath,
  getMemoryPath,
  getPolicyPath,
  getProjectMemoryPath,
  getSessionRootPath,
  listSessionApprovals,
  listSessions,
  loadActiveSession,
  loadSessionById,
  loadSessionMessages,
  loadSessionToolEvents,
  openMemoryFile,
  readConfig,
  readRecentAudit,
  renameActiveSession,
  rewindActiveSession,
  saveSessionMessages,
  saveSessionToolEvents,
  setActiveSessionPlanPhase,
  switchSession,
  writeConfig,
  writeDefaultGlobalPolicy,
  writeDefaultPolicy
} from "./chunk-4U5RDCXH.js";

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
          maxTurns: context.maxTurns ?? 12,
          appendSystemPrompt: buildRuntimeMemoryPrompt(context.cwd)
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

// src/mcp.ts
import fs from "fs";
import path from "path";
var MCP_CONFIG_NAME = ".happycode-mcp.json";
function getMcpConfigPath(cwd) {
  return path.join(cwd, MCP_CONFIG_NAME);
}
function loadMcpConfig(cwd) {
  const p = getMcpConfigPath(cwd);
  if (!fs.existsSync(p)) {
    return { servers: [] };
  }
  try {
    const raw = fs.readFileSync(p, "utf8");
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
  fs.writeFileSync(p, `${JSON.stringify(config, null, 2)}
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

// src/ui.tsx
import fs4 from "fs";
import path4 from "path";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import TextInput from "ink-text-input";

// src/plan_mode_state.ts
import fs2 from "fs";
import os from "os";
import path2 from "path";
var HAPPYCODE_ROOT = path2.join(os.homedir(), ".happycode");
var PLANS_DIR = path2.join(HAPPYCODE_ROOT, "plans");
var TASKS_DIR = path2.join(HAPPYCODE_ROOT, "tasks");
var SNAPSHOT_DIR = path2.join(PLANS_DIR, ".snapshots");
var META_START = "<!-- HAPPYCODE_PLAN_META_START -->";
var META_END = "<!-- HAPPYCODE_PLAN_META_END -->";
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function ensureStorageDirs() {
  fs2.mkdirSync(PLANS_DIR, { recursive: true });
  fs2.mkdirSync(TASKS_DIR, { recursive: true });
  fs2.mkdirSync(SNAPSHOT_DIR, { recursive: true });
}
function randomId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
function planMarkdownPath(planId) {
  return path2.join(PLANS_DIR, `${planId}.md`);
}
function planMetaPath(planId) {
  return path2.join(PLANS_DIR, `${planId}.meta.json`);
}
function taskSnapshotPath(planId) {
  return path2.join(TASKS_DIR, `${planId}.json`);
}
function taskEventsPath(planId) {
  return path2.join(TASKS_DIR, `${planId}.events.ndjson`);
}
function writeJson(filePath, payload) {
  fs2.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}
`, "utf8");
}
function appendTaskEvent(planId, event) {
  fs2.appendFileSync(taskEventsPath(planId), `${JSON.stringify(event)}
`, "utf8");
}
function computeStats(items) {
  return {
    total: items.length,
    todo: items.filter((item) => item.status === "todo").length,
    doing: items.filter((item) => item.status === "doing").length,
    done: items.filter((item) => item.status === "done").length,
    blocked: items.filter((item) => item.status === "blocked").length
  };
}
function computeProgress(items) {
  const total = items.length;
  const done = items.filter((item) => item.status === "done").length;
  const percent = total > 0 ? Number((done / total * 100).toFixed(1)) : 0;
  return {
    done,
    total,
    percent
  };
}
function findCurrentTaskId(items) {
  return items.find((item) => item.status === "doing")?.id;
}
function normalizeTitle(raw) {
  return raw.replace(/^[\-\*]\s*(?:\[[ xX\-]\]\s*)?/, "").replace(/^\d+[\.)\]:：]\s*/, "").trim();
}
function extractPlanItems(planText) {
  const lines = planText.replace(/\r\n/g, "\n").split("\n");
  const items = lines.map((line) => line.trim()).filter(Boolean).filter((line) => /^[-*]\s+\S+/.test(line) || /^\d+[\.)\]:：]\s+\S+/.test(line)).map(normalizeTitle).filter((title) => title.length > 0);
  return Array.from(new Set(items));
}
function statusToCheckbox(status) {
  if (status === "done") {
    return "[x]";
  }
  if (status === "doing") {
    return "[-]";
  }
  return "[ ]";
}
function checkboxToStatus(checkbox, blockedReason) {
  if (checkbox === "[x]") {
    return "done";
  }
  if (checkbox === "[-]") {
    return "doing";
  }
  return blockedReason ? "blocked" : "todo";
}
function renderPlanMarkdown(meta, items) {
  const lines = [];
  lines.push(`# Task Plan: ${meta.planId}`);
  lines.push("");
  lines.push(META_START);
  lines.push(JSON.stringify(meta, null, 2));
  lines.push(META_END);
  lines.push("");
  lines.push("## Meta");
  lines.push(`- plan_id: ${meta.planId}`);
  lines.push(`- session_id: ${meta.sessionId}`);
  lines.push(`- phase: ${meta.phase}`);
  lines.push(`- created_at: ${meta.createdAt}`);
  lines.push(`- updated_at: ${meta.updatedAt}`);
  lines.push("");
  lines.push("## Steps");
  for (const item of items) {
    lines.push(`- ${statusToCheckbox(item.status)} ${item.id} ${item.title}`);
    if (item.notes) {
      lines.push(`  - note: ${item.notes}`);
    }
    if (item.blockedReason) {
      lines.push(`  - blocked: ${item.blockedReason}`);
    }
    if (item.startedAt) {
      lines.push(`  - started_at: ${item.startedAt}`);
    }
    if (item.completedAt) {
      lines.push(`  - completed_at: ${item.completedAt}`);
    }
  }
  lines.push("");
  lines.push("## Execution Log");
  lines.push("- initialized");
  lines.push("");
  return `${lines.join("\n")}`;
}
function parseMetaBlock(markdown) {
  const start = markdown.indexOf(META_START);
  const end = markdown.indexOf(META_END);
  if (start < 0 || end < 0 || end <= start) {
    return null;
  }
  const body = markdown.slice(start + META_START.length, end).trim();
  if (!body) {
    return null;
  }
  try {
    const parsed = JSON.parse(body);
    if (!parsed || typeof parsed.planId !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
function parseItems(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const items = [];
  let current = null;
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const stepMatch = line.match(/^\s*[-*]\s*(\[[ xX\-]\])\s+(task_\d+)\s+(.+)$/);
    if (stepMatch) {
      const checkbox = stepMatch[1].toLowerCase() === "[x]" ? "[x]" : stepMatch[1] === "[-]" ? "[-]" : "[ ]";
      const item = {
        id: stepMatch[2],
        title: stepMatch[3].trim(),
        status: checkboxToStatus(checkbox),
        updatedAt: nowIso()
      };
      items.push(item);
      current = item;
      continue;
    }
    if (!current) {
      continue;
    }
    const noteMatch = line.match(/^\s*[-*]\s+note:\s*(.+)$/i);
    if (noteMatch) {
      current.notes = noteMatch[1].trim();
      continue;
    }
    const blockedMatch = line.match(/^\s*[-*]\s+blocked:\s*(.+)$/i);
    if (blockedMatch) {
      current.blockedReason = blockedMatch[1].trim();
      current.status = "blocked";
      continue;
    }
    const startedMatch = line.match(/^\s*[-*]\s+started_at:\s*(.+)$/i);
    if (startedMatch) {
      current.startedAt = startedMatch[1].trim();
      continue;
    }
    const completedMatch = line.match(/^\s*[-*]\s+completed_at:\s*(.+)$/i);
    if (completedMatch) {
      current.completedAt = completedMatch[1].trim();
      continue;
    }
  }
  return items;
}
function parsePlanMarkdown(planId) {
  const filePath = planMarkdownPath(planId);
  if (!fs2.existsSync(filePath)) {
    return null;
  }
  const body = fs2.readFileSync(filePath, "utf8");
  const meta = parseMetaBlock(body);
  if (!meta) {
    return null;
  }
  const items = parseItems(body);
  const bodyLines = body.replace(/\r\n/g, "\n").split("\n");
  return {
    meta,
    items,
    bodyLines
  };
}
function writePlanMarkdown(planId, meta, items, logLine) {
  const filePath = planMarkdownPath(planId);
  const existing = fs2.existsSync(filePath) ? fs2.readFileSync(filePath, "utf8") : "";
  const next = renderPlanMarkdown(meta, items);
  const logSegment = existing.includes("## Execution Log") ? existing.slice(existing.indexOf("## Execution Log")).split("\n").slice(1).filter((line) => line.trim().length > 0) : [];
  if (logLine) {
    logSegment.push(`- ${logLine}`);
  }
  const merged = `${next.replace(/\n\s*## Execution Log\n- initialized\n?\s*$/m, "")}
## Execution Log
${logSegment.length > 0 ? logSegment.join("\n") : "- initialized"}
`;
  if (existing) {
    const snapDir = path2.join(SNAPSHOT_DIR, planId);
    fs2.mkdirSync(snapDir, { recursive: true });
    const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[\:\.]/g, "-");
    fs2.writeFileSync(path2.join(snapDir, `${stamp}.md`), existing, "utf8");
    const snapshots = fs2.readdirSync(snapDir).filter((name) => name.endsWith(".md")).sort();
    if (snapshots.length > 20) {
      for (const old of snapshots.slice(0, snapshots.length - 20)) {
        fs2.unlinkSync(path2.join(snapDir, old));
      }
    }
  }
  fs2.writeFileSync(filePath, merged, "utf8");
}
function toSnapshot(meta, items) {
  const normalizedItems = items.map((item) => ({
    ...item,
    status: item.blockedReason ? item.status === "done" ? "done" : "blocked" : item.status
  }));
  const stats = computeStats(normalizedItems);
  const progress = computeProgress(normalizedItems);
  const phase = meta.phase !== "completed" && progress.total > 0 && progress.done === progress.total && stats.blocked === 0 ? "completed" : meta.phase;
  const currentTaskId = meta.currentTaskId ?? findCurrentTaskId(normalizedItems);
  return {
    planId: meta.planId,
    sessionId: meta.sessionId,
    phase,
    items: normalizedItems,
    progress,
    currentTaskId,
    lastUpdatedTaskId: meta.lastUpdatedTaskId,
    blockedCount: stats.blocked,
    stats,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt
  };
}
function migrateLegacyJsonIfNeeded(planId) {
  const markdownFile = planMarkdownPath(planId);
  if (fs2.existsSync(markdownFile)) {
    return false;
  }
  const legacyPath = taskSnapshotPath(planId);
  if (!fs2.existsSync(legacyPath)) {
    return false;
  }
  try {
    const legacy = JSON.parse(fs2.readFileSync(legacyPath, "utf8"));
    if (!legacy || !Array.isArray(legacy.items) || typeof legacy.sessionId !== "string") {
      return false;
    }
    ensureStorageDirs();
    const meta = {
      planId,
      sessionId: legacy.sessionId,
      phase: legacy.phase ?? "planning",
      createdAt: legacy.createdAt ?? nowIso(),
      updatedAt: legacy.updatedAt ?? nowIso(),
      currentTaskId: legacy.currentTaskId,
      lastUpdatedTaskId: legacy.lastUpdatedTaskId
    };
    writePlanMarkdown(planId, meta, legacy.items, "migrated_from_json");
    appendTaskEvent(planId, {
      eventType: "migrated_from_json",
      planId,
      ts: nowIso(),
      source: "migration"
    });
    return true;
  } catch {
    return false;
  }
}
function createPlanArtifacts(args) {
  const steps = extractPlanItems(args.planText);
  if (steps.length < 2) {
    return null;
  }
  ensureStorageDirs();
  const createdAt = nowIso();
  const planId = args.planId ?? randomId();
  const meta = {
    planId,
    sessionId: args.sessionId,
    phase: "planning",
    createdAt,
    updatedAt: createdAt,
    sourcePrompt: args.sourcePrompt
  };
  const items = steps.map((title, index) => ({
    id: `task_${index + 1}`,
    title,
    status: "todo",
    updatedAt: createdAt
  }));
  writeJson(planMetaPath(planId), {
    ...meta,
    sourcePrompt: args.sourcePrompt
  });
  writePlanMarkdown(planId, meta, items, "plan_created");
  appendTaskEvent(planId, {
    eventType: "plan_created",
    planId,
    ts: createdAt,
    source: "mode_plan"
  });
  const snapshot = toSnapshot(meta, items);
  writeJson(taskSnapshotPath(planId), snapshot);
  return {
    planId,
    snapshot
  };
}
function loadTaskSnapshot(planId) {
  ensureStorageDirs();
  migrateLegacyJsonIfNeeded(planId);
  const parsed = parsePlanMarkdown(planId);
  if (!parsed) {
    return null;
  }
  const snapshot = toSnapshot(parsed.meta, parsed.items);
  writeJson(taskSnapshotPath(planId), snapshot);
  return snapshot;
}
function saveTaskSnapshot(snapshot) {
  ensureStorageDirs();
  const meta = {
    planId: snapshot.planId,
    sessionId: snapshot.sessionId,
    phase: snapshot.phase,
    createdAt: snapshot.createdAt,
    updatedAt: nowIso(),
    currentTaskId: snapshot.currentTaskId,
    lastUpdatedTaskId: snapshot.lastUpdatedTaskId
  };
  const items = snapshot.items.map((item) => ({ ...item, updatedAt: item.updatedAt || meta.updatedAt }));
  writePlanMarkdown(snapshot.planId, meta, items, "snapshot_saved");
  const next = toSnapshot(meta, items);
  writeJson(taskSnapshotPath(snapshot.planId), next);
  return next;
}
function enterSolvingPhase(planId, source = "ui") {
  const snapshot = loadTaskSnapshot(planId);
  if (!snapshot) {
    return null;
  }
  const ts = nowIso();
  const items = snapshot.items.map((item) => ({ ...item }));
  let currentTaskId = snapshot.currentTaskId;
  const existingDoing = items.find((item) => item.status === "doing");
  if (!existingDoing) {
    const firstTodo = items.find((item) => item.status === "todo");
    if (firstTodo) {
      firstTodo.status = "doing";
      firstTodo.startedAt = firstTodo.startedAt ?? ts;
      firstTodo.attempts = (firstTodo.attempts ?? 0) + 1;
      firstTodo.updatedAt = ts;
      currentTaskId = firstTodo.id;
      appendTaskEvent(planId, {
        eventType: "task_started",
        planId,
        taskId: firstTodo.id,
        from: "todo",
        to: "doing",
        ts,
        source
      });
    }
  } else {
    currentTaskId = existingDoing.id;
  }
  appendTaskEvent(planId, {
    eventType: "phase_changed",
    planId,
    from: snapshot.phase,
    to: "solving",
    ts,
    source
  });
  return saveTaskSnapshot({
    ...snapshot,
    phase: "solving",
    currentTaskId,
    lastUpdatedTaskId: currentTaskId,
    items
  });
}
function startNextTodoTask(planId, items, source) {
  const nextItems = items.map((item) => ({ ...item }));
  const nextTodo = nextItems.find((item) => item.status === "todo");
  if (!nextTodo) {
    return {
      items: nextItems,
      currentTaskId: void 0
    };
  }
  const ts = nowIso();
  nextTodo.status = "doing";
  nextTodo.updatedAt = ts;
  nextTodo.startedAt = nextTodo.startedAt ?? ts;
  nextTodo.attempts = (nextTodo.attempts ?? 0) + 1;
  appendTaskEvent(planId, {
    eventType: "task_started",
    planId,
    taskId: nextTodo.id,
    from: "todo",
    to: "doing",
    ts,
    source
  });
  return {
    items: nextItems,
    currentTaskId: nextTodo.id
  };
}
function updateCurrentTaskOutcome(planId, outcome, options) {
  const snapshot = loadTaskSnapshot(planId);
  if (!snapshot || snapshot.phase !== "solving") {
    return snapshot;
  }
  const source = options?.source ?? "runtime";
  const note = options?.note?.trim() ?? "";
  const ts = nowIso();
  const items = snapshot.items.map((item) => ({ ...item }));
  const current = items.find((item) => item.status === "doing");
  if (!current) {
    return snapshot;
  }
  if (outcome === "doing") {
    if (!note) {
      return snapshot;
    }
    current.notes = note;
    current.updatedAt = ts;
    appendTaskEvent(planId, {
      eventType: "task_note_updated",
      planId,
      taskId: current.id,
      ts,
      source,
      note
    });
    return saveTaskSnapshot({
      ...snapshot,
      items,
      currentTaskId: current.id,
      lastUpdatedTaskId: current.id
    });
  }
  if (outcome === "blocked") {
    current.status = "blocked";
    current.blockedReason = note || current.blockedReason;
    current.notes = note || current.notes;
    current.updatedAt = ts;
    appendTaskEvent(planId, {
      eventType: "task_blocked",
      planId,
      taskId: current.id,
      from: "doing",
      to: "blocked",
      ts,
      source,
      note
    });
    return saveTaskSnapshot({
      ...snapshot,
      items,
      currentTaskId: void 0,
      lastUpdatedTaskId: current.id
    });
  }
  current.status = "done";
  current.completedAt = ts;
  current.updatedAt = ts;
  if (note) {
    current.notes = note;
  }
  appendTaskEvent(planId, {
    eventType: "task_completed",
    planId,
    taskId: current.id,
    from: "doing",
    to: "done",
    ts,
    source,
    note
  });
  const withNext = startNextTodoTask(planId, items, source);
  return saveTaskSnapshot({
    ...snapshot,
    items: withNext.items,
    currentTaskId: withNext.currentTaskId,
    lastUpdatedTaskId: current.id
  });
}
function ensureSolvingTaskConsistency(planId, source = "self_heal") {
  const snapshot = loadTaskSnapshot(planId);
  if (!snapshot || snapshot.phase !== "solving") {
    return snapshot;
  }
  const doingCount = snapshot.items.filter((item) => item.status === "doing").length;
  if (doingCount > 0) {
    return snapshot;
  }
  const hasTodo = snapshot.items.some((item) => item.status === "todo");
  if (!hasTodo) {
    return saveTaskSnapshot(snapshot);
  }
  const withNext = startNextTodoTask(planId, snapshot.items, source);
  return saveTaskSnapshot({
    ...snapshot,
    items: withNext.items,
    currentTaskId: withNext.currentTaskId
  });
}
function parseTaskOutcomeFromAssistantReply(reply) {
  const normalized = reply.replace(/\r\n/g, "\n");
  const stateMatch = normalized.match(/^TASK_STATE:\s*(done|blocked|doing)\s*$/gim);
  if (!stateMatch || stateMatch.length === 0) {
    return null;
  }
  const lastStateLine = stateMatch[stateMatch.length - 1] ?? "";
  const outcomeMatch = lastStateLine.match(/(done|blocked|doing)/i);
  if (!outcomeMatch) {
    return null;
  }
  const noteMatch = normalized.match(/^TASK_NOTE:\s*(.*)$/gim);
  const note = noteMatch && noteMatch.length > 0 ? noteMatch[noteMatch.length - 1]?.replace(/^TASK_NOTE:\s*/i, "").trim() : "";
  return {
    outcome: outcomeMatch[1].toLowerCase(),
    note: note || void 0
  };
}
function formatTaskProgressLine(snapshot) {
  const current = snapshot.items.find((item) => item.id === snapshot.currentTaskId);
  return [
    `plan=${snapshot.planId}`,
    `phase=${snapshot.phase}`,
    `progress=${snapshot.progress.done}/${snapshot.progress.total} (${snapshot.progress.percent}%)`,
    `doing=${current ? current.title : "none"}`,
    `blocked=${snapshot.blockedCount}`
  ].join(" | ");
}
function sortByStatus(items) {
  const order = {
    doing: 0,
    blocked: 1,
    todo: 2,
    done: 3
  };
  return [...items].sort((a, b) => {
    const left = order[a.status] ?? 9;
    const right = order[b.status] ?? 9;
    if (left !== right) {
      return left - right;
    }
    return a.id.localeCompare(b.id);
  });
}
function formatTaskSummary(snapshot) {
  const header = [
    `plan_id: ${snapshot.planId}`,
    `phase: ${snapshot.phase}`,
    `progress: ${snapshot.progress.done}/${snapshot.progress.total} (${snapshot.progress.percent}%)`,
    `stats: total=${snapshot.stats.total} todo=${snapshot.stats.todo} doing=${snapshot.stats.doing} blocked=${snapshot.stats.blocked} done=${snapshot.stats.done}`,
    `current_task: ${snapshot.items.find((item) => item.id === snapshot.currentTaskId)?.title ?? "(none)"}`
  ];
  const rows = sortByStatus(snapshot.items).map(
    (item) => `- [${item.status}] ${item.id} ${item.title}${item.notes ? ` (${item.notes})` : ""}${item.blockedReason ? ` [reason: ${item.blockedReason}]` : ""}`
  );
  return [...header, "", ...rows].join("\n");
}
function formatTaskTodos(snapshot) {
  const lines = snapshot.items.map((item) => {
    const checked = item.status === "done" ? "x" : item.status === "doing" ? "-" : " ";
    const statusTag = item.status === "done" ? "" : ` (${item.status})`;
    return `- [${checked}] ${item.title}${statusTag}`;
  });
  return lines.join("\n");
}

// src/rollback.ts
import fs3 from "fs";
import path3 from "path";
import { execSync } from "child_process";
function listFilesSafe(cwd) {
  try {
    const output = execSync("git ls-files", {
      cwd,
      stdio: ["ignore", "pipe", "ignore"]
    }).toString("utf8").trim();
    if (!output) {
      return [];
    }
    return output.split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}
function fileExists(cwd, relPath) {
  return fs3.existsSync(path3.join(cwd, relPath));
}
function readFileOptional(cwd, relPath) {
  const full = path3.join(cwd, relPath);
  if (!fs3.existsSync(full)) {
    return null;
  }
  try {
    return fs3.readFileSync(full, "utf8");
  } catch {
    return null;
  }
}
function capturePreTurnSnapshot(args) {
  const gitFiles = listFilesSafe(args.cwd);
  const hadGit = gitFiles.length > 0;
  const trackedFiles = hadGit ? gitFiles : [];
  const fileContentsBefore = {};
  for (const rel of trackedFiles) {
    fileContentsBefore[rel] = readFileOptional(args.cwd, rel);
  }
  return {
    historyEntryId: args.historyEntryId,
    cwd: args.cwd,
    history: [...args.history],
    toolEvents: [...args.toolEvents],
    inputBeforeTurn: args.inputBeforeTurn,
    inputHistoryBeforeTurn: [...args.inputHistoryBeforeTurn],
    suggestionIndexBeforeTurn: args.suggestionIndexBeforeTurn,
    trackedFiles,
    fileContentsBefore,
    hadGit
  };
}
function rollbackCode(snapshot) {
  if (!snapshot.hadGit) {
    return {
      ok: false,
      message: "No git repository detected for code rollback."
    };
  }
  const touched = /* @__PURE__ */ new Set();
  for (const rel of snapshot.trackedFiles) {
    const before = snapshot.fileContentsBefore[rel] ?? null;
    const now = readFileOptional(snapshot.cwd, rel);
    if (before !== now) {
      touched.add(rel);
    }
  }
  if (touched.size === 0) {
    return {
      ok: true,
      message: "No code changes detected since turn start."
    };
  }
  for (const rel of touched) {
    const before = snapshot.fileContentsBefore[rel] ?? null;
    const full = path3.join(snapshot.cwd, rel);
    if (before === null) {
      if (fileExists(snapshot.cwd, rel)) {
        try {
          fs3.unlinkSync(full);
        } catch (err) {
          return {
            ok: false,
            message: `Failed to remove ${rel}: ${err instanceof Error ? err.message : String(err)}`
          };
        }
      }
      continue;
    }
    try {
      fs3.mkdirSync(path3.dirname(full), { recursive: true });
      fs3.writeFileSync(full, before, "utf8");
    } catch (err) {
      return {
        ok: false,
        message: `Failed to restore ${rel}: ${err instanceof Error ? err.message : String(err)}`
      };
    }
  }
  return {
    ok: true,
    message: `Restored ${touched.size} file(s).`
  };
}

// src/ui.tsx
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
  { cmd: "/solve", complete: "/solve", desc: "Enter solve phase for active plan" },
  { cmd: "/test [command]", complete: "/test", desc: "Run tests via tools" },
  { cmd: "/fix", complete: "/fix", desc: "Investigate and fix issues" },
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
  { cmd: "/allow once <command>", complete: "/allow once ", desc: "Approve exact shell command once" },
  { cmd: "/allow session <prefix>", complete: "/allow session ", desc: "Approve shell prefix for session" },
  { cmd: "/allow global <prefix>", complete: "/allow global ", desc: "Approve shell prefix globally" },
  { cmd: "/approvals", complete: "/approvals", desc: "Show command approvals" },
  { cmd: "/approvals clear", complete: "/approvals clear", desc: "Clear session + one-time approvals" },
  { cmd: "/approvals clear global", complete: "/approvals clear global", desc: "Clear global command approvals" },
  { cmd: "/policy init", complete: "/policy init", desc: "Create policy file" },
  { cmd: "/policy path", complete: "/policy path", desc: "Show policy path" },
  { cmd: "/policy global init", complete: "/policy global init", desc: "Create global policy file" },
  { cmd: "/policy global path", complete: "/policy global path", desc: "Show global policy path" },
  { cmd: "/init", complete: "/init", desc: "Show important file paths" },
  { cmd: "/clear", complete: "/clear", desc: "Clear conversation" },
  { cmd: "/exit", complete: "/exit", desc: "Quit" }
];
var MODE_DISPLAY = {
  auto: {
    label: "Auto",
    hint: "Automatically chooses planning or execution",
    color: "yellow"
  },
  edit: {
    label: "Edit",
    hint: "Directly implements changes in code",
    color: "blue"
  },
  plan: {
    label: "Plan",
    hint: "Focuses on analysis and step-by-step planning",
    color: "green"
  }
};
var HELP_TEXT = [
  COMMANDS.map((item) => `${item.cmd.padEnd(34, " ")} ${item.desc}`).join("\n"),
  "",
  "Modes:",
  "  plan  Analysis and implementation planning",
  "  edit  Direct coding and code changes",
  "  auto  Adaptive mode selection",
  "Shortcut: Shift+Tab to cycle modes"
].join("\n");
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
function isShiftTabInput(inputKey, key) {
  return key.tab && key.shift || inputKey === "\x1B[Z";
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
  configuredModel,
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
    maxTurns: defaultRuntime?.maxTurns ?? 24,
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
  const [resumePickerOpen, setResumePickerOpen] = useState(false);
  const [resumeCandidates, setResumeCandidates] = useState([]);
  const [resumeCursor, setResumeCursor] = useState(0);
  const [pendingUserQuestion, setPendingUserQuestion] = useState(null);
  const [questionFocus, setQuestionFocus] = useState("option");
  const [selectedTypeIndex, setSelectedTypeIndex] = useState(0);
  const [selectedOptionIndex, setSelectedOptionIndex] = useState(0);
  const [memoryPickerOpen, setMemoryPickerOpen] = useState(false);
  const [memoryPickerCursor, setMemoryPickerCursor] = useState(0);
  const [taskProgressLine, setTaskProgressLine] = useState("");
  const [rollbackArmedUntil, setRollbackArmedUntil] = useState(null);
  const [inputHistory, setInputHistory] = useState([]);
  const [historyBrowseActive, setHistoryBrowseActive] = useState(false);
  const [historyBrowseIndex, setHistoryBrowseIndex] = useState(null);
  const [draftBeforeHistoryBrowse, setDraftBeforeHistoryBrowse] = useState("");
  const [rollbackHistoryPickerOpen, setRollbackHistoryPickerOpen] = useState(false);
  const [rollbackHistoryCursor, setRollbackHistoryCursor] = useState(0);
  const pendingQuestionResolveRef = useRef(null);
  const toolSeqRef = useRef(0);
  const toolTurnRef = useRef(0);
  const toolEventsHydratedRef = useRef(false);
  const streamingBufferRef = useRef("");
  const streamingFlushTimerRef = useRef(null);
  const interruptControllerRef = useRef(null);
  const preTurnSnapshotRef = useRef(null);
  const snapshotByHistoryIdRef = useRef(/* @__PURE__ */ new Map());
  const rollbackCandidates = useMemo(() => {
    return inputHistory.filter((item) => snapshotByHistoryIdRef.current.has(item.id));
  }, [inputHistory]);
  const visibleRollbackCandidates = useMemo(() => {
    return rollbackCandidates.slice(-20);
  }, [rollbackCandidates]);
  const themeStyle = THEME_STYLES[theme];
  const projectPath = useMemo(() => process.cwd(), []);
  const contentWidth = useMemo(() => Math.max(24, terminalColumns - 2), [terminalColumns]);
  const flowSeparator = useMemo(() => "\u2500".repeat(contentWidth), [contentWidth]);
  const shiftMode = useCallback(() => {
    setRuntime((prev) => {
      const currentIdx = MODE_CYCLE.indexOf(prev.mode);
      const nextMode = MODE_CYCLE[(currentIdx + 1 + MODE_CYCLE.length) % MODE_CYCLE.length] ?? MODE_CYCLE[0];
      return { ...prev, mode: nextMode };
    });
  }, []);
  const closeUserQuestion = useCallback(() => {
    setPendingUserQuestion(null);
    setQuestionFocus("option");
    setSelectedTypeIndex(0);
    setSelectedOptionIndex(0);
  }, []);
  const executeRollback = useCallback(
    (mode, historyEntryId) => {
      const snapshot = historyEntryId ? snapshotByHistoryIdRef.current.get(historyEntryId) ?? null : preTurnSnapshotRef.current;
      if (!snapshot) {
        if (historyEntryId) {
          const selected = inputHistory.find((item) => item.id === historyEntryId);
          if (selected) {
            setInput(selected.text);
            setInputKey((prev) => prev + 1);
            setError("No rollback snapshot for this history item. Restored input draft only.");
            return;
          }
        }
        setError("No rollback snapshot available.");
        return;
      }
      if (mode === "keep") {
        setError("Rollback cancelled.");
        return;
      }
      setHistory(snapshot.history);
      onHistoryChange?.(snapshot.history);
      setToolEvents(snapshot.toolEvents);
      toolSeqRef.current = snapshot.toolEvents.reduce(
        (max, item) => item.seq > max ? item.seq : max,
        0
      );
      toolTurnRef.current = snapshot.toolEvents.reduce(
        (max, item) => item.turn > max ? item.turn : max,
        0
      );
      setInputHistory(snapshot.inputHistoryBeforeTurn);
      setHistoryBrowseActive(false);
      setHistoryBrowseIndex(null);
      setDraftBeforeHistoryBrowse("");
      setSuggestionIndex(snapshot.suggestionIndexBeforeTurn);
      setInput(snapshot.inputBeforeTurn);
      setInputKey((prev) => prev + 1);
      setError("Rolled back dialogue to selected point.");
      if (mode === "dialogue_only") {
        return;
      }
      const code = rollbackCode(snapshot);
      setError(code.ok ? `Rolled back dialogue + code. ${code.message}` : `Dialogue rolled back, code rollback failed: ${code.message}`);
    },
    [inputHistory, onHistoryChange]
  );
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
      title: pendingUserQuestion.title,
      meta: pendingUserQuestion.meta ?? {}
    };
    if (pendingUserQuestion.title === "Shell approval required") {
      const meta = pendingUserQuestion.meta ?? {};
      const command = typeof meta.command === "string" ? meta.command : "";
      const sessionPrefix = typeof meta.sessionPrefix === "string" ? meta.sessionPrefix : "";
      if (answer.optionId === "allow_once" && command) {
        approveCommandOnce(command, process.cwd());
      } else if (answer.optionId === "allow_session") {
        const value = sessionPrefix || command;
        if (value) {
          approveCommandForSession(value, process.cwd());
        }
      } else if (answer.optionId === "allow_global") {
        const value = sessionPrefix || command;
        if (value) {
          allowGlobalCommandPrefix(value);
        }
      }
    }
    const resolver = pendingQuestionResolveRef.current;
    pendingQuestionResolveRef.current = null;
    closeUserQuestion();
    if (pendingUserQuestion.title === "Rollback code as well?") {
      const optionId = answer.optionId;
      const mode = optionId === "rollback_both" ? "both" : optionId === "rollback_dialogue" ? "dialogue_only" : "keep";
      const selectedId = typeof pendingUserQuestion.meta?.historyEntryId === "string" ? pendingUserQuestion.meta.historyEntryId : void 0;
      executeRollback(mode, selectedId);
      resolver(answer);
      return;
    }
    resolver(answer);
  }, [closeUserQuestion, executeRollback, pendingUserQuestion, selectedOptionIndex, selectedTypeIndex]);
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
      setInputHistory(switched.inputHistory ?? []);
      setHistoryBrowseActive(false);
      setHistoryBrowseIndex(null);
      setDraftBeforeHistoryBrowse("");
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
      setError(null);
      const result = await openMemoryFile(scope, process.cwd());
      if (!result.ok) {
        return;
      }
    },
    []
  );
  const refreshTaskProgressLine = useCallback(() => {
    const active = loadActiveSession(process.cwd());
    if (!active.activePlanId) {
      setTaskProgressLine("");
      return;
    }
    const snapshot = loadTaskSnapshot(active.activePlanId);
    if (!snapshot) {
      setTaskProgressLine("");
      return;
    }
    setTaskProgressLine(formatTaskProgressLine(snapshot));
  }, []);
  useEffect(() => {
    refreshTaskProgressLine();
  }, [history, refreshTaskProgressLine]);
  useEffect(() => {
    setInputHistory(getInputHistory(process.cwd()));
  }, []);
  useEffect(() => {
    if (!rollbackArmedUntil) {
      return;
    }
    const timer = setTimeout(() => {
      setRollbackArmedUntil((current) => {
        if (!current || Date.now() >= current) {
          return null;
        }
        return current;
      });
    }, Math.max(0, rollbackArmedUntil - Date.now()));
    return () => clearTimeout(timer);
  }, [rollbackArmedUntil]);
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
    const now = Date.now();
    if (key.escape && !pendingUserQuestion && !rollbackHistoryPickerOpen && !resumePickerOpen && !memoryPickerOpen) {
      const armed = rollbackArmedUntil !== null && now <= rollbackArmedUntil;
      if (armed) {
        setRollbackArmedUntil(null);
        if (visibleRollbackCandidates.length === 0) {
          setError("No rollback points available.");
          return;
        }
        setRollbackHistoryPickerOpen(true);
        setRollbackHistoryCursor(visibleRollbackCandidates.length - 1);
        return;
      }
      if (loading && interruptControllerRef.current) {
        interruptControllerRef.current.abort();
      }
      setRollbackArmedUntil(now + 1200);
      setError(
        loading ? "Interrupted. Press Esc again within 1.2s to open rollback list." : "Press Esc again within 1.2s to open rollback list."
      );
      return;
    }
    if (rollbackHistoryPickerOpen) {
      if (key.escape) {
        setRollbackHistoryPickerOpen(false);
        return;
      }
      if (visibleRollbackCandidates.length === 0) {
        setRollbackHistoryPickerOpen(false);
        return;
      }
      if (key.upArrow) {
        setRollbackHistoryCursor((prev) => Math.max(0, prev - 1));
        return;
      }
      if (key.downArrow) {
        setRollbackHistoryCursor((prev) => Math.min(visibleRollbackCandidates.length - 1, prev + 1));
        return;
      }
      if (key.return) {
        const selected = visibleRollbackCandidates[rollbackHistoryCursor];
        if (!selected) {
          return;
        }
        setRollbackHistoryPickerOpen(false);
        setQuestionFocus("option");
        setSelectedTypeIndex(0);
        setSelectedOptionIndex(0);
        setPendingUserQuestion({
          title: "Rollback code as well?",
          question: `Selected input: ${selected.text.slice(0, 80)}${selected.text.length > 80 ? "..." : ""}`,
          types: ["single_choice"],
          options: [
            { id: "rollback_both", label: "Rollback code + dialogue", description: "Restore files and conversation." },
            { id: "rollback_dialogue", label: "Rollback dialogue only", description: "Keep code changes." },
            { id: "keep", label: "Keep current state", description: "Do not rollback." }
          ],
          defaultType: "single_choice",
          defaultOptionId: "rollback_both",
          meta: { kind: "rollback_confirm", historyEntryId: selected.id }
        });
        pendingQuestionResolveRef.current = () => {
        };
        return;
      }
      return;
    }
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
    if (rollbackHistoryPickerOpen) {
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
    if (isShiftTabInput(inputKey2, key)) {
      shiftMode();
      setError(null);
      return;
    }
    if (!loading && !pendingUserQuestion && !resumePickerOpen && !memoryPickerOpen && inputHistory.length > 0) {
      if (key.upArrow) {
        if (!historyBrowseActive) {
          setHistoryBrowseActive(true);
          setDraftBeforeHistoryBrowse(input);
          const index = inputHistory.length - 1;
          setHistoryBrowseIndex(index);
          setInputAtEnd(inputHistory[index]?.text ?? "");
          return;
        }
        const current = historyBrowseIndex ?? inputHistory.length;
        const next = Math.max(0, current - 1);
        setHistoryBrowseIndex(next);
        setInputAtEnd(inputHistory[next]?.text ?? "");
        return;
      }
      if (key.downArrow && historyBrowseActive) {
        const current = historyBrowseIndex ?? inputHistory.length - 1;
        const next = current + 1;
        if (next >= inputHistory.length) {
          setHistoryBrowseActive(false);
          setHistoryBrowseIndex(null);
          setInputAtEnd(draftBeforeHistoryBrowse);
          return;
        }
        setHistoryBrowseIndex(next);
        setInputAtEnd(inputHistory[next]?.text ?? "");
        return;
      }
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
    async (taskPrompt, modeOverride, historyEntryIdOverride) => {
      const historyEntryId = historyEntryIdOverride ?? inputHistory[inputHistory.length - 1]?.id ?? "";
      preTurnSnapshotRef.current = capturePreTurnSnapshot({
        historyEntryId,
        cwd: process.cwd(),
        history,
        toolEvents,
        inputBeforeTurn: input,
        inputHistoryBeforeTurn: inputHistory,
        suggestionIndexBeforeTurn: suggestionIndex
      });
      if (historyEntryId && preTurnSnapshotRef.current) {
        snapshotByHistoryIdRef.current.set(historyEntryId, preTurnSnapshotRef.current);
      }
      const abortController = new AbortController();
      interruptControllerRef.current = abortController;
      setRollbackArmedUntil(null);
      const effectiveMode = modeOverride ?? runtime.mode;
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
        const reply = await agent.chatStream(
          nextHistory,
          {
            mode: effectiveMode,
            cwd: process.cwd(),
            enableAudit,
            model: runtime.model,
            fallbackModel: runtime.fallbackModel,
            maxTurns: runtime.maxTurns,
            allowedTools: runtime.allowedTools,
            disallowedTools: runtime.disallowedTools,
            systemPrompt: runtime.systemPrompt,
            appendSystemPrompt: runtime.appendSystemPrompt,
            mcpTools,
            mcpCall: mcpManager ? (fullName, args) => mcpManager.callTool(fullName, args) : void 0,
            abortSignal: abortController.signal,
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
                defaultOptionId: typeof payload.defaultOptionId === "string" ? payload.defaultOptionId : "",
                meta: payload.meta && typeof payload.meta === "object" ? payload.meta : void 0
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
        let finalReply = reply;
        if (effectiveMode === "plan") {
          const active = loadActiveSession(process.cwd());
          const persisted = createPlanArtifacts({
            sessionId: active.id,
            planText: reply,
            sourcePrompt: taskPrompt
          });
          if (persisted) {
            bindPlanToActiveSession(persisted.planId, persisted.planId, "planning", process.cwd());
            finalReply = `${reply}

---
plan_state: saved
plan_id: ${persisted.planId}
phase: planning
tasks: ${persisted.snapshot.stats.total}`;
            setTaskProgressLine(formatTaskProgressLine(persisted.snapshot));
          }
        } else {
          const active = loadActiveSession(process.cwd());
          if (active.activePlanId && active.planSolvePhase === "solving") {
            const parsed = parseTaskOutcomeFromAssistantReply(reply);
            if (parsed) {
              const updated = updateCurrentTaskOutcome(active.activePlanId, parsed.outcome, {
                note: parsed.note,
                source: "assistant_reply"
              });
              if (updated) {
                finalReply = `${reply}

---
${formatTaskProgressLine(updated)}`;
                if (updated.phase === "completed") {
                  setActiveSessionPlanPhase("completed", process.cwd());
                }
                setTaskProgressLine(formatTaskProgressLine(updated));
              }
            } else {
              const healed = ensureSolvingTaskConsistency(active.activePlanId, "turn_consistency");
              if (healed) {
                if (healed.phase === "completed") {
                  setActiveSessionPlanPhase("completed", process.cwd());
                }
                setTaskProgressLine(formatTaskProgressLine(healed));
              }
            }
          }
        }
        setHistory((prev) => {
          const assistantMessage = { role: "assistant", content: finalReply };
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
        const message = err instanceof Error ? err.message : String(err);
        if (abortController.signal.aborted || /Interrupted by user\./i.test(message)) {
          pushAssistant("Interrupted by user.", setHistory, onHistoryChange);
        } else {
          setError(message);
        }
      } finally {
        if (streamingFlushTimerRef.current) {
          clearTimeout(streamingFlushTimerRef.current);
          streamingFlushTimerRef.current = null;
        }
        setLoading(false);
        if (interruptControllerRef.current === abortController) {
          interruptControllerRef.current = null;
        }
      }
    },
    [agent, enableAudit, history, input, inputHistory, onHistoryChange, runtime, suggestionIndex, toolEvents]
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
          `active_session: ${active.id} (${active.name})`,
          `active_plan: ${active.activePlanId ?? "(none)"}`,
          `plan_phase: ${active.planSolvePhase ?? "planning"}`,
          `task_progress: ${taskProgressLine || "(none)"}`
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
        clearActiveSessionPlanBinding(process.cwd());
        setTaskProgressLine("");
        preTurnSnapshotRef.current = null;
        snapshotByHistoryIdRef.current.clear();
        setHistoryBrowseActive(false);
        setHistoryBrowseIndex(null);
        setDraftBeforeHistoryBrowse("");
        setRollbackHistoryPickerOpen(false);
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
      if (content === "/solve") {
        const active = loadActiveSession(process.cwd());
        const planId = active.activePlanId;
        if (!planId) {
          pushAssistant("No active plan is bound to this session yet.", setHistory, onHistoryChange);
          return true;
        }
        const next = enterSolvingPhase(planId, "slash_solve");
        if (!next) {
          pushAssistant(`Task state file missing for plan: ${planId}`, setHistory, onHistoryChange);
          return true;
        }
        setActiveSessionPlanPhase("solving", process.cwd());
        setTaskProgressLine(formatTaskProgressLine(next));
        preTurnSnapshotRef.current = null;
        pushAssistant(formatTaskSummary(next), setHistory, onHistoryChange);
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
        const active = loadActiveSession(process.cwd());
        const planId = active.activePlanId;
        if (!planId) {
          pushAssistant("No active plan state found. Use plan mode to generate a plan first.", setHistory, onHistoryChange);
          return true;
        }
        const snapshot = loadTaskSnapshot(planId);
        if (!snapshot) {
          pushAssistant(`Task state file missing for plan: ${planId}`, setHistory, onHistoryChange);
          return true;
        }
        if (snapshot.phase === "solving") {
          const healed = ensureSolvingTaskConsistency(planId, "slash_tasks") ?? snapshot;
          setTaskProgressLine(formatTaskProgressLine(healed));
          pushAssistant(formatTaskSummary(healed), setHistory, onHistoryChange);
          return true;
        }
        setTaskProgressLine(formatTaskProgressLine(snapshot));
        pushAssistant(formatTaskSummary(snapshot), setHistory, onHistoryChange);
        return true;
      }
      if (content === "/todos") {
        const active = loadActiveSession(process.cwd());
        const planId = active.activePlanId;
        if (!planId) {
          pushAssistant("No active plan state found. Use plan mode to generate a plan first.", setHistory, onHistoryChange);
          return true;
        }
        const snapshot = loadTaskSnapshot(planId);
        if (!snapshot) {
          pushAssistant(`Task state file missing for plan: ${planId}`, setHistory, onHistoryChange);
          return true;
        }
        if (snapshot.phase === "solving") {
          const healed = ensureSolvingTaskConsistency(planId, "slash_todos") ?? snapshot;
          setTaskProgressLine(formatTaskProgressLine(healed));
          pushAssistant(`plan_id: ${healed.planId}
phase: ${healed.phase}

${formatTaskTodos(healed)}`, setHistory, onHistoryChange);
          return true;
        }
        setTaskProgressLine(formatTaskProgressLine(snapshot));
        pushAssistant(`plan_id: ${snapshot.planId}
phase: ${snapshot.phase}

${formatTaskTodos(snapshot)}`, setHistory, onHistoryChange);
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
          `global_policy: ${getGlobalPolicyPath()}`,
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
        clearActiveSessionPlanBinding(process.cwd());
        setTaskProgressLine("");
        preTurnSnapshotRef.current = null;
        snapshotByHistoryIdRef.current.clear();
        setHistoryBrowseActive(false);
        setHistoryBrowseIndex(null);
        setDraftBeforeHistoryBrowse("");
        setRollbackHistoryPickerOpen(false);
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
        const session = listSessionApprovals(process.cwd());
        const global = getGlobalApprovalPrefixes();
        const source = loadSessionById(loadActiveSession(process.cwd()).id);
        const msg = [
          `Approvals path: ${getApprovalPath()}`,
          "One-time approvals:",
          ...session.once.length ? session.once.map((s) => `- ${s}`) : ["- (none)"],
          "Session approvals:",
          ...session.session.length ? session.session.map((s) => `- ${s}`) : ["- (none)"],
          "Global approvals:",
          ...global.length ? global.map((s) => `- ${s}`) : ["- (none)"],
          source?.name ? `Active session: ${source.name} (${source.id})` : ""
        ].filter(Boolean).join("\n");
        pushAssistant(msg, setHistory, onHistoryChange);
        return true;
      }
      if (content === "/approvals clear global") {
        clearGlobalCommandApprovals();
        pushAssistant("Cleared global command approvals.", setHistory, onHistoryChange);
        return true;
      }
      if (content === "/approvals clear") {
        clearSessionApprovals(process.cwd());
        pushAssistant("Cleared one-time and session approvals.", setHistory, onHistoryChange);
        return true;
      }
      if (content.startsWith("/allow once ")) {
        const cmd = content.replace("/allow once ", "").trim();
        if (!cmd) {
          setError("Usage: /allow once <command>");
        } else {
          approveCommandOnce(cmd, process.cwd());
          pushAssistant(`Approved one-time command: ${cmd}`, setHistory, onHistoryChange);
        }
        return true;
      }
      if (content.startsWith("/allow session ")) {
        const prefix = content.replace("/allow session ", "").trim();
        if (!prefix) {
          setError("Usage: /allow session <command-prefix>");
        } else {
          approveCommandForSession(prefix, process.cwd());
          pushAssistant(`Approved session prefix: ${prefix}`, setHistory, onHistoryChange);
        }
        return true;
      }
      if (content.startsWith("/allow global ")) {
        const prefix = content.replace("/allow global ", "").trim();
        if (!prefix) {
          setError("Usage: /allow global <command-prefix>");
        } else {
          allowGlobalCommandPrefix(prefix);
          pushAssistant(`Approved global prefix: ${prefix}`, setHistory, onHistoryChange);
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
      if (content === "/policy global init") {
        const p = writeDefaultGlobalPolicy();
        pushAssistant(`Global policy initialized at: ${p}`, setHistory, onHistoryChange);
        return true;
      }
      if (content === "/policy global path") {
        const p = getGlobalPolicyPath();
        pushAssistant(`Global policy path: ${p}`, setHistory, onHistoryChange);
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
      inputHistory,
      loading,
      memoryPickerOpen,
      onHistoryChange,
      pendingUserQuestion,
      resumePickerOpen,
      runAgentTask,
      openMemoryByScope,
      rollbackHistoryPickerOpen,
      runtime,
      taskProgressLine
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
    if (rollbackHistoryPickerOpen) {
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
    let nextInputHistory = inputHistory;
    let historyEntryIdForTurn = "";
    if (content.trim()) {
      nextInputHistory = appendInputHistoryEntry(content, process.cwd());
      setInputHistory(nextInputHistory);
      historyEntryIdForTurn = nextInputHistory[nextInputHistory.length - 1]?.id ?? "";
    }
    setHistoryBrowseActive(false);
    setHistoryBrowseIndex(null);
    setDraftBeforeHistoryBrowse("");
    if (content.startsWith("/")) {
      const handled = handleSlashCommand(content);
      if (!handled) {
        pushAssistant(`Unknown command: ${content}
Use /help`, setHistory, onHistoryChange);
      }
      return;
    }
    await runAgentTask(content, void 0, historyEntryIdForTurn);
  }, [
    inputSuggestions,
    draftBeforeHistoryBrowse,
    exit,
    handleSlashCommand,
    historyBrowseActive,
    historyBrowseIndex,
    input,
    inputHistory,
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
    rollbackHistoryPickerOpen,
    pendingUserQuestion
  ]);
  useEffect(() => {
    if (!loading) {
      setRollbackArmedUntil(null);
    }
  }, [loading]);
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
  const modeDisplay = MODE_DISPLAY[runtime.mode] ?? MODE_DISPLAY.auto;
  return /* @__PURE__ */ jsxs(Box, { flexDirection: "column", padding: 1, children: [
    /* @__PURE__ */ jsxs(Box, { borderStyle: "round", borderColor: themeStyle.titleColor, paddingX: 1, flexDirection: "column", width: contentWidth, children: [
      /* @__PURE__ */ jsx(Text, { color: themeStyle.titleColor, children: ":) HappyCode" }),
      /* @__PURE__ */ jsxs(Text, { color: themeStyle.metaColor, children: [
        "Project: ",
        projectPath
      ] }),
      /* @__PURE__ */ jsxs(Text, { color: themeStyle.metaColor, children: [
        "Model: ",
        configuredModel ?? "(not configured)"
      ] }),
      /* @__PURE__ */ jsxs(Box, { children: [
        /* @__PURE__ */ jsx(Text, { color: themeStyle.metaColor, children: "Mode: " }),
        /* @__PURE__ */ jsx(Text, { color: modeDisplay.color, children: modeDisplay.label }),
        /* @__PURE__ */ jsx(Text, { color: themeStyle.metaColor, children: " (Shift+Tab cycles)" })
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
          /* @__PURE__ */ jsxs(Box, { paddingX: 1, flexDirection: "column", children: [
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
      /* @__PURE__ */ jsxs(Box, { children: [
        /* @__PURE__ */ jsx(Text, { color: "green", children: "> " }),
        /* @__PURE__ */ jsx(TextInput, { value: input, onChange: setInput, onSubmit: submit }, inputKey),
        inlineParamPlaceholder ? /* @__PURE__ */ jsx(Text, { color: "gray", children: inlineParamPlaceholder }) : null
      ] }),
      /* @__PURE__ */ jsxs(Box, { marginTop: 1, children: [
        /* @__PURE__ */ jsx(Text, { color: "gray", children: "Mode: " }),
        /* @__PURE__ */ jsx(Text, { color: modeDisplay.color, children: modeDisplay.label }),
        /* @__PURE__ */ jsxs(Text, { color: "gray", children: [
          " - ",
          modeDisplay.hint,
          " (Shift+Tab to cycle)"
        ] })
      ] }),
      taskProgressLine ? /* @__PURE__ */ jsxs(Box, { marginTop: 1, children: [
        /* @__PURE__ */ jsx(Text, { color: "cyan", children: "Task Progress: " }),
        /* @__PURE__ */ jsx(Text, { color: "gray", children: taskProgressLine })
      ] }) : null,
      historyBrowseActive ? /* @__PURE__ */ jsx(Box, { children: /* @__PURE__ */ jsxs(Text, { color: "gray", children: [
        "Input History: ",
        (historyBrowseIndex ?? 0) + 1,
        "/",
        inputHistory.length,
        " (\u2191/\u2193 browse, Enter submit)"
      ] }) }) : null
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
    ] }) : null,
    rollbackHistoryPickerOpen ? /* @__PURE__ */ jsxs(Box, { marginTop: 1, flexDirection: "column", width: contentWidth, children: [
      /* @__PURE__ */ jsx(Text, { color: "white", children: "Rollback Points (\u2191/\u2193 choose, Enter confirm, Esc cancel)" }),
      visibleRollbackCandidates.map((item, idx) => {
        const selected = idx === rollbackHistoryCursor;
        const preview = item.text.replace(/\r\n/g, " ").replace(/\n/g, " ").slice(0, 90);
        return /* @__PURE__ */ jsxs(Text, { color: selected ? "cyan" : "white", children: [
          selected ? ">" : " ",
          " ",
          preview,
          /* @__PURE__ */ jsxs(Text, { color: "gray", children: [
            " (",
            item.createdAt,
            ")"
          ] })
        ] }, item.id);
      })
    ] }) : null
  ] });
}

// src/cli.ts
var program = new Command();
var DEFAULT_MAX_TURNS = 24;
var MIN_MAX_TURNS = 1;
var MAX_MAX_TURNS = 200;
function parseMaxTurns(value, fallback, context) {
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : Number.NaN;
  if (!Number.isFinite(parsed)) {
    if (value !== void 0) {
      process.stderr.write(`[warn] Invalid --max-turns in ${context}; using ${fallback}.
`);
    }
    return fallback;
  }
  const clamped = Math.max(MIN_MAX_TURNS, Math.min(MAX_MAX_TURNS, Math.trunc(parsed)));
  if (clamped !== parsed) {
    process.stderr.write(
      `[warn] --max-turns in ${context} was clamped to ${clamped} (allowed ${MIN_MAX_TURNS}-${MAX_MAX_TURNS}).
`
    );
  }
  return clamped;
}
program.name("happycode").description("Coding-focused TUI for OpenAI-compatible APIs").version("0.1.0");
program.command("init").description("Save base URL and API key").requiredOption("--base-url <url>", "OpenAI-compatible base URL, e.g. https://api.openai.com/v1").requiredOption("--api-key <key>", "API key").option("--model <model>", "Model name", "gpt-4o-mini").option("--max-turns <n>", "Default max tool turns", String(DEFAULT_MAX_TURNS)).action((options) => {
  const maxTurns = parseMaxTurns(options.maxTurns, DEFAULT_MAX_TURNS, "init");
  writeConfig({
    baseUrl: options.baseUrl,
    apiKey: options.apiKey,
    model: options.model,
    maxTurns
  });
  process.stdout.write(`Saved config to ${getConfigPath()}
`);
});
program.command("run").description("Start TUI").option("--mode <mode>", `Default mode: ${SUPPORTED_MODES.join("|")}`, "auto").option("--model <name>", "Override model").option("--fallback-model <name>", "Fallback model on failure").option("--max-turns <n>", "Max tool turns").option("--allowed-tools <csv>", "Comma separated allowed tools").option("--disallowed-tools <csv>", "Comma separated disallowed tools").option("--system-prompt <text>", "Override system prompt").option("--append-system-prompt <text>", "Append additional system prompt text").option("--resume <sessionId>", "Resume by session id").option("--new [name]", "Start a fresh session").option("--no-audit", "Disable tool audit log").action((options) => {
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
  const resolvedFallback = cfg.maxTurns ?? DEFAULT_MAX_TURNS;
  const maxTurns = parseMaxTurns(options.maxTurns, resolvedFallback, "run");
  const allowedTools = String(options.allowedTools ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  const disallowedTools = String(options.disallowedTools ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  render(
    React2.createElement(App, {
      agent,
      appVersion: program.version(),
      defaultMode: mode,
      defaultModel: options.model,
      configuredModel: cfg.model,
      defaultRuntime: {
        mode,
        model: options.model,
        fallbackModel: options.fallbackModel,
        maxTurns,
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
program.command("chat").description("Single-turn non-interactive chat").requiredOption("-m, --message <text>", "User message").option("--mode <mode>", `Mode: ${SUPPORTED_MODES.join("|")}`, "plan").option("--model <name>", "Override model").option("--fallback-model <name>", "Fallback model on failure").option("--max-turns <n>", "Max tool turns").option("--allowed-tools <csv>", "Comma separated allowed tools").option("--disallowed-tools <csv>", "Comma separated disallowed tools").option("--system-prompt <text>", "Override system prompt").option("--append-system-prompt <text>", "Append additional system prompt text").option("--json", "Print JSON output").option("--stream-json", "Stream JSON chunks").option("--no-audit", "Disable tool audit log").action(async (options) => {
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
  const resolvedFallback = cfg.maxTurns ?? DEFAULT_MAX_TURNS;
  const maxTurns = parseMaxTurns(options.maxTurns, resolvedFallback, "chat");
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
      maxTurns,
      allowedTools,
      disallowedTools,
      systemPrompt: options.systemPrompt,
      appendSystemPrompt: options.appendSystemPrompt,
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
program.command("policy").description("Policy file helpers").option("--path", "Print policy file path").option("--global-path", "Print global policy file path").option("--init", "Create default policy file if missing").option("--global-init", "Create default global policy file if missing").action((options) => {
  if (options.path) {
    process.stdout.write(`${getPolicyPath(process.cwd())}
`);
    return;
  }
  if (options.globalPath) {
    process.stdout.write(`${getGlobalPolicyPath()}
`);
    return;
  }
  if (options.init) {
    const p = writeDefaultPolicy(process.cwd());
    process.stdout.write(`Policy ready: ${p}
`);
    return;
  }
  if (options.globalInit) {
    const p = writeDefaultGlobalPolicy();
    process.stdout.write(`Global policy ready: ${p}
`);
    return;
  }
  process.stdout.write("Use --path, --global-path, --init, or --global-init\n");
});
program.command("approvals").description("Command approval helpers").option("--path", "Print approvals storage path").option("--list", "List global approved prefixes").option("--list-global", "List global approved prefixes").option("--clear", "Clear global approved prefixes").option("--clear-global", "Clear global approved prefixes").action((options) => {
  if (options.path) {
    process.stdout.write(`${getApprovalPath()}
`);
    return;
  }
  if (options.list || options.listGlobal) {
    process.stdout.write(`${JSON.stringify(getGlobalApprovalPrefixes(), null, 2)}
`);
    return;
  }
  if (options.clear || options.clearGlobal) {
    clearGlobalCommandApprovals();
    process.stdout.write("Cleared approvals.\n");
    return;
  }
  process.stdout.write("Use --path, --list, --list-global, --clear, or --clear-global\n");
});
if (process.argv.length === 2) {
  process.argv.push("run");
}
program.parse();
