// src/modes.ts
function getModePolicy(mode) {
  switch (mode) {
    case "plan":
      return { allowWrite: false, allowExec: false };
    case "edit":
      return { allowWrite: true, allowExec: true };
    case "auto":
      return { allowWrite: true, allowExec: true };
    default:
      return { allowWrite: false, allowExec: false };
  }
}
function getModePrompt(mode) {
  switch (mode) {
    case "plan":
      return [
        "Mode=plan.",
        "You must produce an explicit, ordered implementation plan before execution.",
        "Include goals, constraints, milestones, risks, validation strategy, and rollback/alternative options.",
        "Format the plan as clear actionable steps (ordered list or markdown tasks) so runtime can persist task state.",
        "Do not execute implementation work in this mode.",
        "If key details are missing or uncertain, call user_question to request a decision instead of guessing.",
        "You may inspect files, but do not modify files or run shell commands."
      ].join(" ");
    case "edit":
      return "Mode=edit. You may inspect/edit project files and run shell commands when required. Shell commands remain subject to runtime safety policy and user approval prompts. If uncertain, call user_question for explicit user choice. If session is in solve phase, append a status control line: TASK_STATE: done|blocked|doing and optional TASK_NOTE: <short note>.";
    case "auto":
      return "Mode=auto. You may inspect/edit files and run shell commands when required. If uncertain, call user_question for explicit user choice. If session is in solve phase, append a status control line: TASK_STATE: done|blocked|doing and optional TASK_NOTE: <short note>.";
    default:
      return "Mode=plan. Produce a clear implementation plan first.";
  }
}
var SUPPORTED_MODES = ["plan", "edit", "auto"];

// src/audit.ts
import fs from "fs";
import os from "os";
import path from "path";
var AUDIT_DIR = path.join(os.homedir(), ".happycode");
var AUDIT_PATH = path.join(AUDIT_DIR, "audit.log");
function ensureDir() {
  fs.mkdirSync(AUDIT_DIR, { recursive: true });
}
function getAuditPath() {
  return AUDIT_PATH;
}
function appendAudit(record) {
  ensureDir();
  fs.appendFileSync(AUDIT_PATH, `${JSON.stringify(record)}
`, "utf8");
}
function readRecentAudit(limit = 50) {
  if (!fs.existsSync(AUDIT_PATH)) {
    return [];
  }
  const raw = fs.readFileSync(AUDIT_PATH, "utf8");
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const slice = lines.slice(-Math.max(1, limit));
  const records = [];
  for (const line of slice) {
    try {
      records.push(JSON.parse(line));
    } catch {
      continue;
    }
  }
  return records;
}

// src/approvals.ts
import fs2 from "fs";
import os2 from "os";
import path2 from "path";
var APPROVAL_DIR = path2.join(os2.homedir(), ".happycode");
var APPROVAL_PATH = path2.join(APPROVAL_DIR, "approvals.json");
function ensureDir2() {
  fs2.mkdirSync(APPROVAL_DIR, { recursive: true });
}
function readState() {
  if (!fs2.existsSync(APPROVAL_PATH)) {
    return { globalApprovedCommandPrefixes: [] };
  }
  try {
    const raw = fs2.readFileSync(APPROVAL_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.globalApprovedCommandPrefixes)) {
      return { globalApprovedCommandPrefixes: parsed.globalApprovedCommandPrefixes };
    }
    if (Array.isArray(parsed.approvedCommandPrefixes)) {
      return { globalApprovedCommandPrefixes: parsed.approvedCommandPrefixes };
    }
    return { globalApprovedCommandPrefixes: [] };
  } catch {
    return { globalApprovedCommandPrefixes: [] };
  }
}
function writeState(state) {
  ensureDir2();
  fs2.writeFileSync(APPROVAL_PATH, `${JSON.stringify(state, null, 2)}
`, "utf8");
}
function getApprovalPath() {
  return APPROVAL_PATH;
}
function allowGlobalCommandPrefix(prefix) {
  const state = readState();
  if (!state.globalApprovedCommandPrefixes.includes(prefix)) {
    state.globalApprovedCommandPrefixes.push(prefix);
    writeState(state);
  }
}
function clearGlobalCommandApprovals() {
  writeState({ globalApprovedCommandPrefixes: [] });
}
function isGloballyApprovedCommand(command) {
  const state = readState();
  const value = command.trim().toLowerCase();
  return state.globalApprovedCommandPrefixes.some((prefix) => value.startsWith(prefix.toLowerCase()));
}
function getGlobalApprovalPrefixes() {
  return readState().globalApprovedCommandPrefixes;
}

// src/policy.ts
import fs3 from "fs";
import os3 from "os";
import path3 from "path";
var DEFAULT_ALLOW_PREFIXES = [
  "git status",
  "git diff",
  "git log",
  "git branch",
  "git show",
  "npm test",
  "npm run",
  "pnpm test",
  "pnpm run",
  "yarn test",
  "yarn run",
  "node ",
  "python ",
  "pytest",
  "cargo test",
  "go test",
  "ls",
  "dir",
  "cat",
  "type ",
  "rg ",
  "findstr "
];
var DEFAULT_DENY_PATTERNS = [
  "(^|\\s)rm\\s+-rf\\s+/",
  "(^|\\s)mkfs\\b",
  "(^|\\s)dd\\s+if=",
  "(^|\\s)shutdown\\b",
  "(^|\\s)reboot\\b",
  "(^|\\s)poweroff\\b",
  "(^|\\s)diskpart\\b",
  "(^|\\s)format\\s+[a-z]:",
  "(^|\\s)del\\s+\\/f\\s+\\/s\\s+\\/q\\b",
  "(^|\\s)Remove-Item\\b.+-Recurse.+-Force",
  "(^|\\s)git\\s+reset\\s+--hard\\b"
];
var DEFAULT_PROTECTED_PATHS = [".git", "node_modules"];
var GLOBAL_POLICY_DIR = path3.join(os3.homedir(), ".happycode");
var GLOBAL_POLICY_PATH = path3.join(GLOBAL_POLICY_DIR, "policy.json");
function mergeUnique(values) {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))];
}
function resolveField(projectValue, globalValue, fallback) {
  if (Array.isArray(projectValue)) {
    return mergeUnique(projectValue);
  }
  if (Array.isArray(globalValue)) {
    return mergeUnique(globalValue);
  }
  return [...fallback];
}
function getPolicyPath(cwd) {
  return path3.join(cwd, ".happycode-policy.json");
}
function getGlobalPolicyPath() {
  return GLOBAL_POLICY_PATH;
}
function readPolicyFile(policyPath) {
  if (!fs3.existsSync(policyPath)) {
    return {};
  }
  try {
    const raw = fs3.readFileSync(policyPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
function loadPolicy(cwd) {
  const policyPath = getPolicyPath(cwd);
  const rawProject = readPolicyFile(policyPath);
  const rawGlobal = readPolicyFile(getGlobalPolicyPath());
  return {
    policyPath,
    allowShellPrefixes: resolveField(rawProject.allowShellPrefixes, rawGlobal.allowShellPrefixes, DEFAULT_ALLOW_PREFIXES),
    denyShellPatterns: resolveField(rawProject.denyShellPatterns, rawGlobal.denyShellPatterns, DEFAULT_DENY_PATTERNS),
    protectedPaths: resolveField(rawProject.protectedPaths, rawGlobal.protectedPaths, DEFAULT_PROTECTED_PATHS)
  };
}
function writeDefaultPolicy(cwd) {
  const policyPath = getPolicyPath(cwd);
  if (fs3.existsSync(policyPath)) {
    return policyPath;
  }
  const sample = {
    allowShellPrefixes: DEFAULT_ALLOW_PREFIXES,
    denyShellPatterns: DEFAULT_DENY_PATTERNS,
    protectedPaths: DEFAULT_PROTECTED_PATHS
  };
  fs3.writeFileSync(policyPath, `${JSON.stringify(sample, null, 2)}
`, "utf8");
  return policyPath;
}
function writeDefaultGlobalPolicy() {
  const policyPath = getGlobalPolicyPath();
  if (fs3.existsSync(policyPath)) {
    return policyPath;
  }
  fs3.mkdirSync(path3.dirname(policyPath), { recursive: true });
  const sample = {
    allowShellPrefixes: DEFAULT_ALLOW_PREFIXES,
    denyShellPatterns: DEFAULT_DENY_PATTERNS,
    protectedPaths: DEFAULT_PROTECTED_PATHS
  };
  fs3.writeFileSync(policyPath, `${JSON.stringify(sample, null, 2)}
`, "utf8");
  return policyPath;
}
function isProtectedRelativePath(relPath, policy) {
  const normalized = relPath.replace(/\\/g, "/").replace(/^\.\//, "");
  return policy.protectedPaths.some((item) => {
    const p = item.replace(/\\/g, "/").replace(/^\.\//, "");
    return normalized === p || normalized.startsWith(`${p}/`);
  });
}

// src/session.ts
import fs4 from "fs";
import os4 from "os";
import path4 from "path";
import { createHash } from "crypto";
var SESSION_ROOT = path4.join(os4.homedir(), ".happycode", "sessions");
var ACTIVE_FILE = path4.join(SESSION_ROOT, "active-session.txt");
var ACTIVE_MAP_FILE = path4.join(SESSION_ROOT, "active-sessions.json");
function ensureDir3() {
  fs4.mkdirSync(SESSION_ROOT, { recursive: true });
}
function safeName(input) {
  return input.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60) || "session";
}
function resolveProjectRoot(cwd) {
  const target = path4.resolve(cwd);
  try {
    return fs4.realpathSync(target);
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
    toolEvents: Array.isArray(record.toolEvents) ? record.toolEvents : [],
    sessionApprovedCommandPrefixes: Array.isArray(record.sessionApprovedCommandPrefixes) ? record.sessionApprovedCommandPrefixes : [],
    oneTimeApprovedCommands: Array.isArray(record.oneTimeApprovedCommands) ? record.oneTimeApprovedCommands : [],
    planSolvePhase: record.planSolvePhase ?? "planning",
    activePlanVersion: typeof record.activePlanVersion === "number" ? record.activePlanVersion : 1,
    lastOrchestratorStep: record.lastOrchestratorStep ?? "planning",
    inputHistory: normalizeInputHistory(record.inputHistory)
  };
}
function readActiveMap() {
  ensureDir3();
  if (!fs4.existsSync(ACTIVE_MAP_FILE)) {
    return {};
  }
  try {
    const raw = fs4.readFileSync(ACTIVE_MAP_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
function writeActiveMap(map) {
  ensureDir3();
  fs4.writeFileSync(ACTIVE_MAP_FILE, `${JSON.stringify(map, null, 2)}
`, "utf8");
}
function isProjectMatch(record, projectKey) {
  return !record.projectKey || record.projectKey === projectKey;
}
function sessionPathById(id) {
  return path4.join(SESSION_ROOT, `${id}.json`);
}
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function randomId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
function normalizeInputHistory(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }
  const now = nowIso();
  const normalized = [];
  for (const item of entries) {
    if (typeof item === "string") {
      const text2 = item.trim();
      if (text2) {
        normalized.push({
          id: randomId(),
          text: text2,
          createdAt: now
        });
      }
      continue;
    }
    if (!item || typeof item !== "object") {
      continue;
    }
    const candidate = item;
    const text = typeof candidate.text === "string" ? candidate.text.trim() : "";
    if (!text) {
      continue;
    }
    normalized.push({
      id: typeof candidate.id === "string" && candidate.id.trim() ? candidate.id : randomId(),
      text,
      createdAt: typeof candidate.createdAt === "string" && candidate.createdAt.trim() ? candidate.createdAt : now
    });
  }
  return normalized.slice(-100);
}
function getSessionRootPath() {
  ensureDir3();
  return SESSION_ROOT;
}
function getLegacySessionPath() {
  return path4.join(os4.homedir(), ".happycode", "session.json");
}
function createSession(name = "default", cwd = process.cwd()) {
  ensureDir3();
  const meta = projectMetaFromCwd(cwd);
  const id = randomId();
  const record = {
    id,
    name: safeName(name),
    createdAt: nowIso(),
    updatedAt: nowIso(),
    messages: [],
    toolEvents: [],
    sessionApprovedCommandPrefixes: [],
    oneTimeApprovedCommands: [],
    projectKey: meta.projectKey,
    projectRoot: meta.projectRoot,
    planSolvePhase: "planning",
    inputHistory: []
  };
  saveSessionRecord(record);
  setActiveSessionId(id, cwd);
  return record;
}
function saveSessionRecord(record) {
  ensureDir3();
  const next = {
    ...record,
    name: safeName(record.name),
    toolEvents: Array.isArray(record.toolEvents) ? record.toolEvents : [],
    sessionApprovedCommandPrefixes: Array.isArray(record.sessionApprovedCommandPrefixes) ? record.sessionApprovedCommandPrefixes : [],
    oneTimeApprovedCommands: Array.isArray(record.oneTimeApprovedCommands) ? record.oneTimeApprovedCommands : [],
    planSolvePhase: record.planSolvePhase ?? "planning",
    inputHistory: normalizeInputHistory(record.inputHistory),
    updatedAt: nowIso()
  };
  fs4.writeFileSync(sessionPathById(next.id), `${JSON.stringify(next, null, 2)}
`, "utf8");
}
function loadSessionById(id) {
  const p = sessionPathById(id);
  if (!fs4.existsSync(p)) {
    return null;
  }
  try {
    const raw = fs4.readFileSync(p, "utf8");
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
  ensureDir3();
  const { projectKey } = projectMetaFromCwd(cwd);
  const files = fs4.readdirSync(SESSION_ROOT).filter((item) => item.endsWith(".json")).map((item) => path4.join(SESSION_ROOT, item));
  const sessions = [];
  for (const file of files) {
    try {
      const raw = fs4.readFileSync(file, "utf8");
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
  ensureDir3();
  const { projectKey } = projectMetaFromCwd(cwd);
  const map = readActiveMap();
  map[projectKey] = id;
  writeActiveMap(map);
  fs4.writeFileSync(ACTIVE_FILE, `${id}
`, "utf8");
}
function getActiveSessionId(cwd = process.cwd()) {
  const { projectKey } = projectMetaFromCwd(cwd);
  const map = readActiveMap();
  const scoped = map[projectKey];
  if (scoped) {
    return scoped;
  }
  if (fs4.existsSync(ACTIVE_FILE)) {
    try {
      const legacyId = fs4.readFileSync(ACTIVE_FILE, "utf8").trim();
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
function getInputHistory(cwd = process.cwd()) {
  const active = loadActiveSession(cwd);
  return active.inputHistory ?? [];
}
function appendInputHistoryEntry(entry, cwd = process.cwd()) {
  const normalized = entry.trim();
  if (!normalized) {
    return getInputHistory(cwd);
  }
  const active = loadActiveSession(cwd);
  const history = active.inputHistory ?? [];
  if (history[history.length - 1]?.text === normalized) {
    return history;
  }
  const next = [
    ...history,
    {
      id: randomId(),
      text: normalized,
      createdAt: nowIso()
    }
  ].slice(-100);
  active.inputHistory = next;
  saveSessionRecord(active);
  return next;
}
function bindPlanToActiveSession(planId, taskSetId, phase = "planning", cwd = process.cwd()) {
  const active = loadActiveSession(cwd);
  active.activePlanId = planId;
  active.activeTaskSetId = taskSetId;
  active.planSolvePhase = phase;
  active.activePlanVersion = active.activePlanVersion ?? 1;
  active.lastOrchestratorStep = phase === "solving" ? "tasking" : "planning";
  saveSessionRecord(active);
  return active;
}
function setActiveSessionPlanPhase(phase, cwd = process.cwd()) {
  const active = loadActiveSession(cwd);
  active.planSolvePhase = phase;
  active.lastOrchestratorStep = phase === "solving" ? "tasking" : phase === "planning" ? "planning" : active.lastOrchestratorStep;
  saveSessionRecord(active);
  return active;
}
function setActiveSessionPlanRuntimeState(state, cwd = process.cwd()) {
  const active = loadActiveSession(cwd);
  if (typeof state.planVersion === "number" && Number.isFinite(state.planVersion)) {
    active.activePlanVersion = Math.max(1, Math.floor(state.planVersion));
  }
  if (state.orchestratorStep) {
    active.lastOrchestratorStep = state.orchestratorStep;
  }
  saveSessionRecord(active);
  return active;
}
function clearActiveSessionPlanBinding(cwd = process.cwd()) {
  const active = loadActiveSession(cwd);
  delete active.activePlanId;
  delete active.activeTaskSetId;
  delete active.activePlanVersion;
  delete active.lastOrchestratorStep;
  active.planSolvePhase = "planning";
  saveSessionRecord(active);
  return active;
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
    sessionApprovedCommandPrefixes: [...active.sessionApprovedCommandPrefixes ?? []],
    oneTimeApprovedCommands: [],
    projectKey: active.projectKey,
    projectRoot: active.projectRoot,
    activePlanId: active.activePlanId,
    activeTaskSetId: active.activeTaskSetId,
    planSolvePhase: active.planSolvePhase ?? "planning",
    activePlanVersion: active.activePlanVersion,
    lastOrchestratorStep: active.lastOrchestratorStep,
    inputHistory: [...active.inputHistory ?? []]
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
function normalizeCommand(command) {
  return command.trim().replace(/\s+/g, " ").toLowerCase();
}
function approveCommandForSession(prefix, cwd = process.cwd()) {
  const normalized = normalizeCommand(prefix);
  if (!normalized) {
    return;
  }
  const active = loadActiveSession(cwd);
  const list = active.sessionApprovedCommandPrefixes ?? [];
  if (!list.includes(normalized)) {
    active.sessionApprovedCommandPrefixes = [...list, normalized];
    saveSessionRecord(active);
  }
}
function approveCommandOnce(command, cwd = process.cwd()) {
  const normalized = normalizeCommand(command);
  if (!normalized) {
    return;
  }
  const active = loadActiveSession(cwd);
  const list = active.oneTimeApprovedCommands ?? [];
  if (!list.includes(normalized)) {
    active.oneTimeApprovedCommands = [...list, normalized];
    saveSessionRecord(active);
  }
}
function consumeOneTimeApproval(command, cwd = process.cwd()) {
  const normalized = normalizeCommand(command);
  if (!normalized) {
    return false;
  }
  const active = loadActiveSession(cwd);
  const list = active.oneTimeApprovedCommands ?? [];
  const idx = list.indexOf(normalized);
  if (idx < 0) {
    return false;
  }
  const next = [...list.slice(0, idx), ...list.slice(idx + 1)];
  active.oneTimeApprovedCommands = next;
  saveSessionRecord(active);
  return true;
}
function isSessionApprovedCommand(command, cwd = process.cwd()) {
  const normalized = normalizeCommand(command);
  const active = loadActiveSession(cwd);
  const list = active.sessionApprovedCommandPrefixes ?? [];
  return list.some((prefix) => normalized.startsWith(prefix));
}
function listSessionApprovals(cwd = process.cwd()) {
  const active = loadActiveSession(cwd);
  return {
    once: active.oneTimeApprovedCommands ?? [],
    session: active.sessionApprovedCommandPrefixes ?? []
  };
}
function clearSessionApprovals(cwd = process.cwd()) {
  const active = loadActiveSession(cwd);
  active.oneTimeApprovedCommands = [];
  active.sessionApprovedCommandPrefixes = [];
  saveSessionRecord(active);
}

// src/agent.ts
import OpenAI from "openai";

// src/memory.ts
import fs5 from "fs";
import os5 from "os";
import path5 from "path";
import { exec } from "child_process";
var GLOBAL_MEMORY_PATH = path5.join(os5.homedir(), ".happycode", "memory_user.md");
var LEGACY_MEMORY_PATH = path5.join(os5.homedir(), ".happycode", "memory.md");
var PROJECT_MEMORY_DIR = ".happycode";
var PROJECT_MEMORY_FILE = "memory_project.md";
var LEGACY_PROJECT_MEMORY_FILE = ".happycode-memory.md";
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
  fs5.mkdirSync(path5.dirname(filePath), { recursive: true });
}
function scopePath(scope, cwd = process.cwd()) {
  if (scope === "user") {
    return GLOBAL_MEMORY_PATH;
  }
  return path5.join(cwd, PROJECT_MEMORY_DIR, PROJECT_MEMORY_FILE);
}
function legacyProjectScopePath(cwd = process.cwd()) {
  return path5.join(cwd, LEGACY_PROJECT_MEMORY_FILE);
}
function migrateLegacyProjectMemoryIfNeeded(cwd = process.cwd()) {
  const currentPath = scopePath("project", cwd);
  const legacyPath = legacyProjectScopePath(cwd);
  if (fs5.existsSync(currentPath) || !fs5.existsSync(legacyPath)) {
    return;
  }
  const legacyRaw = fs5.readFileSync(legacyPath, "utf8");
  const migratedDoc = parseMemoryMarkdown(legacyRaw, "project");
  writeMemoryDocument("project", migratedDoc, cwd);
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
  if (scope === "project") {
    migrateLegacyProjectMemoryIfNeeded(cwd);
  }
  const target = scopePath(scope, cwd);
  if (!fs5.existsSync(target)) {
    if (scope === "user" && fs5.existsSync(LEGACY_MEMORY_PATH)) {
      const legacy = fs5.readFileSync(LEGACY_MEMORY_PATH, "utf8");
      const migrated = parseMemoryMarkdown(legacy, scope);
      writeMemoryDocument(scope, migrated, cwd);
      return migrated;
    }
    return emptyDocument(scope);
  }
  const raw = fs5.readFileSync(target, "utf8");
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
  fs5.writeFileSync(target, toMemoryMarkdown(normalized), "utf8");
}
function ensureMemoryFile(scope, cwd = process.cwd()) {
  if (scope === "project") {
    migrateLegacyProjectMemoryIfNeeded(cwd);
  }
  const target = scopePath(scope, cwd);
  if (!fs5.existsSync(target)) {
    ensureParentDir(target);
    fs5.writeFileSync(target, defaultMemoryMarkdown(scope), "utf8");
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

// src/tools.ts
import fs6 from "fs";
import path6 from "path";
import { exec as exec2 } from "child_process";
import { promisify } from "util";
import fg from "fast-glob";

// src/security.ts
function validateShellCommand(command, policy) {
  const normalized = command.trim();
  if (!normalized) {
    return { ok: false, reason: "Empty command." };
  }
  for (const rawPattern of policy.denyShellPatterns) {
    try {
      const regex = new RegExp(rawPattern, "i");
      if (regex.test(normalized)) {
        return { ok: false, reason: `Command matches denied pattern: ${rawPattern}` };
      }
    } catch {
      continue;
    }
  }
  const lower = normalized.toLowerCase();
  const allowed = policy.allowShellPrefixes.some((prefix) => lower.startsWith(prefix.toLowerCase()));
  if (!allowed) {
    return { ok: false, reason: "Command not in policy allowShellPrefixes." };
  }
  return { ok: true };
}

// src/tools.ts
var execAsync = promisify(exec2);
var MAX_READ = 3e4;
var MAX_OUTPUT = 2e4;
var USER_QUESTION_PREFIX = "NEEDS_USER_QUESTION::";
var APPROVAL_REQUIRED_PREFIX = "NEEDS_APPROVAL::";
function resolveInCwd(cwd, inputPath) {
  const resolved = path6.resolve(cwd, inputPath);
  const normalizedCwd = path6.resolve(cwd) + path6.sep;
  if (resolved !== path6.resolve(cwd) && !resolved.startsWith(normalizedCwd)) {
    throw new Error("Path escapes current workspace.");
  }
  return resolved;
}
function toRelative(cwd, fullPath) {
  return path6.relative(cwd, fullPath).replace(/\\/g, "/");
}
function clampOutput(text, limit = MAX_OUTPUT) {
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit)}

...[truncated]`;
}
function stringArg(args, key, fallback = "") {
  const value = args?.[key];
  return typeof value === "string" ? value : fallback;
}
function numberArg(args, key, fallback) {
  const value = args?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function assertNotAborted(context) {
  if (context.abortSignal?.aborted) {
    throw new Error("Interrupted by user.");
  }
}
async function runCommand(cwd, command, timeoutMs = 3e4) {
  const { stdout, stderr } = await execAsync(command, {
    cwd,
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 1024 * 1024
  });
  return clampOutput([stdout, stderr].filter(Boolean).join("\n") || "(no output)");
}
async function listFiles(cwd, pattern = "**/*") {
  const entries = await fg(pattern, {
    cwd,
    onlyFiles: true,
    dot: true,
    ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/build/**"]
  });
  return entries.slice(0, 400);
}
function readFile(cwd, filePath) {
  const fullPath = resolveInCwd(cwd, filePath);
  const content = fs6.readFileSync(fullPath, "utf8");
  return clampOutput(content, MAX_READ);
}
function assertWritable(cwd, filePath, mode) {
  if (mode === "auto") {
    return;
  }
  const fullPath = resolveInCwd(cwd, filePath);
  const rel = toRelative(cwd, fullPath);
  const policy = loadPolicy(cwd);
  if (isProtectedRelativePath(rel, policy)) {
    throw new Error(`Path is protected by policy: ${rel}`);
  }
}
function writeFile(cwd, filePath, content, mode) {
  assertWritable(cwd, filePath, mode);
  const fullPath = resolveInCwd(cwd, filePath);
  fs6.mkdirSync(path6.dirname(fullPath), { recursive: true });
  fs6.writeFileSync(fullPath, content, "utf8");
  return `Wrote ${filePath}`;
}
function appendFile(cwd, filePath, content, mode) {
  assertWritable(cwd, filePath, mode);
  const fullPath = resolveInCwd(cwd, filePath);
  fs6.mkdirSync(path6.dirname(fullPath), { recursive: true });
  fs6.appendFileSync(fullPath, content, "utf8");
  return `Appended ${filePath}`;
}
function patchFile(cwd, filePath, findText, replaceText, mode) {
  assertWritable(cwd, filePath, mode);
  const fullPath = resolveInCwd(cwd, filePath);
  const source = fs6.readFileSync(fullPath, "utf8");
  if (!source.includes(findText)) {
    return `Pattern not found in ${filePath}`;
  }
  const next = source.replace(findText, replaceText);
  fs6.writeFileSync(fullPath, next, "utf8");
  return `Patched ${filePath}`;
}
function deleteFile(cwd, filePath, mode) {
  assertWritable(cwd, filePath, mode);
  const fullPath = resolveInCwd(cwd, filePath);
  if (!fs6.existsSync(fullPath)) {
    return `File does not exist: ${filePath}`;
  }
  fs6.unlinkSync(fullPath);
  return `Deleted ${filePath}`;
}
function searchInFiles(cwd, pattern, glob = "**/*.{ts,tsx,js,jsx,py,go,rs,java,md,json,yml,yaml}") {
  const files = fg.sync(glob, {
    cwd,
    onlyFiles: true,
    dot: false,
    ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/build/**"]
  });
  const results = [];
  for (const file of files.slice(0, 700)) {
    const content = fs6.readFileSync(path6.join(cwd, file), "utf8");
    const lines = content.split(/\r?\n/);
    lines.forEach((line, idx) => {
      if (line.includes(pattern)) {
        results.push({ file, line: idx + 1, text: line.trim() });
      }
    });
    if (results.length >= 300) {
      break;
    }
  }
  return clampOutput(JSON.stringify(results, null, 2));
}
function audit(context, call, ok, summary) {
  if (!context.enableAudit) {
    return;
  }
  appendAudit({
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    mode: context.mode,
    tool: call.name,
    ok,
    input: call.args ?? {},
    summary
  });
}
function normalizeCommand2(command) {
  return command.trim().replace(/\s+/g, " ").toLowerCase();
}
function sessionApprovalPrefix(command) {
  return normalizeCommand2(command).split(" ").slice(0, 2).join(" ").trim();
}
function reasonCodeFromPolicyReason(reason) {
  if (reason.startsWith("Command matches denied pattern:")) {
    return "deny_pattern";
  }
  if (reason.startsWith("Command not in policy allowShellPrefixes.")) {
    return "not_allowed_prefix";
  }
  return "approval_required";
}
function buildApprovalPayload(command, reasonCode = "approval_required", policyReason = "") {
  const normalized = normalizeCommand2(command);
  const prefix = sessionApprovalPrefix(command) || normalized;
  const reasonLine = reasonCode === "deny_pattern" ? `High-risk command matched deny pattern. ${policyReason}` : reasonCode === "not_allowed_prefix" ? `Command prefix is not allowed by policy. ${policyReason}` : "Command requires explicit approval in current mode.";
  const payload = {
    title: "Shell approval required",
    question: `Allow shell command in current mode?
${command}

${reasonLine.trim()}`,
    types: ["single_choice"],
    options: [
      {
        id: "allow_once",
        label: "Allow once",
        description: "Allow this exact command one time."
      },
      {
        id: "allow_session",
        label: "Allow session prefix",
        description: `Allow this command prefix for current session: ${prefix}`
      },
      {
        id: "allow_global",
        label: "Allow global prefix",
        description: `Allow this command prefix globally: ${prefix}`
      },
      {
        id: "deny",
        label: "Deny",
        description: "Reject and do not run command."
      }
    ],
    defaultType: "single_choice",
    defaultOptionId: "allow_once",
    meta: {
      command,
      normalized,
      sessionPrefix: sessionApprovalPrefix(command),
      reasonCode,
      policyReason
    }
  };
  return `${APPROVAL_REQUIRED_PREFIX}${JSON.stringify(payload)}`;
}
async function runTool(call, context) {
  const policy = getModePolicy(context.mode);
  const runtimePolicy = loadPolicy(context.cwd);
  try {
    assertNotAborted(context);
    if (call.name === "get_context") {
      const payload = JSON.stringify(
        {
          cwd: context.cwd,
          mode: context.mode,
          policy,
          localPolicyPath: runtimePolicy.policyPath,
          protectedPaths: runtimePolicy.protectedPaths
        },
        null,
        2
      );
      audit(context, call, true, "context returned");
      return payload;
    }
    if (!policy.allowWrite && ["write_file", "append_file", "patch_file", "delete_file"].includes(call.name)) {
      const denied = `Denied by mode policy: ${context.mode} is read-only.`;
      audit(context, call, false, denied);
      return denied;
    }
    if (!policy.allowExec && call.name === "run_shell") {
      const denied = `Denied by mode policy: ${context.mode} cannot run shell commands.`;
      audit(context, call, false, denied);
      return denied;
    }
    let output = "";
    switch (call.name) {
      case "list_files": {
        assertNotAborted(context);
        const pattern = stringArg(call.args, "pattern", "**/*");
        output = JSON.stringify(await listFiles(context.cwd, pattern), null, 2);
        break;
      }
      case "read_file":
        assertNotAborted(context);
        output = readFile(context.cwd, stringArg(call.args, "path"));
        break;
      case "write_file":
        assertNotAborted(context);
        output = writeFile(context.cwd, stringArg(call.args, "path"), stringArg(call.args, "content"), context.mode);
        break;
      case "append_file":
        assertNotAborted(context);
        output = appendFile(context.cwd, stringArg(call.args, "path"), stringArg(call.args, "content"), context.mode);
        break;
      case "patch_file":
        assertNotAborted(context);
        output = patchFile(
          context.cwd,
          stringArg(call.args, "path"),
          stringArg(call.args, "find"),
          stringArg(call.args, "replace"),
          context.mode
        );
        break;
      case "delete_file":
        assertNotAborted(context);
        output = deleteFile(context.cwd, stringArg(call.args, "path"), context.mode);
        break;
      case "search_in_files":
        assertNotAborted(context);
        output = searchInFiles(
          context.cwd,
          stringArg(call.args, "pattern"),
          stringArg(call.args, "glob", "**/*.{ts,tsx,js,jsx,py,go,rs,java,md,json,yml,yaml}")
        );
        break;
      case "run_shell": {
        assertNotAborted(context);
        const command = stringArg(call.args, "command");
        if (context.mode !== "auto") {
          const usedOneTimeApproval = consumeOneTimeApproval(command, context.cwd);
          const approvedInSession = !usedOneTimeApproval && isSessionApprovedCommand(command, context.cwd);
          const approvedGlobally = !usedOneTimeApproval && isGloballyApprovedCommand(command);
          const isApproved = usedOneTimeApproval || approvedInSession || approvedGlobally;
          const check = validateShellCommand(command, runtimePolicy);
          if (!isApproved && !check.ok) {
            const reason = check.reason ?? "unsafe command.";
            const reasonCode = reasonCodeFromPolicyReason(reason);
            output = buildApprovalPayload(command, reasonCode, reason);
            audit(context, call, false, `Approval required before shell execution (${reasonCode}).`);
            return output;
          }
          if (!isApproved) {
            output = buildApprovalPayload(command, "approval_required");
            audit(context, call, false, "Approval required before shell execution.");
            return output;
          }
        }
        assertNotAborted(context);
        output = await runCommand(context.cwd, command, numberArg(call.args, "timeout_ms", 3e4));
        break;
      }
      case "git_status":
        assertNotAborted(context);
        output = await runCommand(context.cwd, "git status --short --branch");
        break;
      case "git_diff": {
        assertNotAborted(context);
        const target = stringArg(call.args, "path", "").trim();
        const cmd = target ? `git diff -- ${target}` : "git diff";
        output = await runCommand(context.cwd, cmd);
        break;
      }
      case "git_log": {
        assertNotAborted(context);
        const count = Math.max(1, Math.min(50, numberArg(call.args, "count", 10)));
        output = await runCommand(context.cwd, `git log --oneline -n ${count}`);
        break;
      }
      case "user_question": {
        const payload = {
          title: stringArg(call.args, "title", "Need your decision"),
          question: stringArg(call.args, "question", "Please choose an option."),
          types: Array.isArray(call.args?.types) ? (call.args?.types).filter((item) => typeof item === "string" && item.trim().length > 0) : ["single_choice"],
          options: Array.isArray(call.args?.options) ? (call.args?.options).filter((item) => typeof item === "object" && item !== null).map((item, index) => ({
            id: typeof item.id === "string" && item.id.trim() ? item.id : `option_${index + 1}`,
            label: typeof item.label === "string" && item.label.trim() ? item.label : `Option ${index + 1}`,
            description: typeof item.description === "string" ? item.description : ""
          })) : [
            { id: "option_1", label: "Proceed with default", description: "Use the default implementation path." },
            { id: "option_2", label: "Ask for clarification", description: "Request more detail before implementation." }
          ],
          defaultType: stringArg(call.args, "defaultType", ""),
          defaultOptionId: stringArg(call.args, "defaultOptionId", "")
        };
        output = `${USER_QUESTION_PREFIX}${JSON.stringify(payload)}`;
        break;
      }
      default:
        output = "Unknown tool";
        break;
    }
    audit(context, call, true, output.slice(0, 160));
    return output;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    audit(context, call, false, message);
    return `Tool error: ${message}`;
  }
}
var TOOL_SCHEMA = [
  {
    type: "function",
    function: {
      name: "list_files",
      description: "List files in workspace by glob pattern",
      parameters: {
        type: "object",
        properties: { pattern: { type: "string" } }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read file content from workspace",
      parameters: {
        type: "object",
        required: ["path"],
        properties: { path: { type: "string" } }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Create or overwrite a file in workspace",
      parameters: {
        type: "object",
        required: ["path", "content"],
        properties: {
          path: { type: "string" },
          content: { type: "string" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "append_file",
      description: "Append text to a file in workspace",
      parameters: {
        type: "object",
        required: ["path", "content"],
        properties: {
          path: { type: "string" },
          content: { type: "string" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "patch_file",
      description: "Patch file by replacing first matched text",
      parameters: {
        type: "object",
        required: ["path", "find", "replace"],
        properties: {
          path: { type: "string" },
          find: { type: "string" },
          replace: { type: "string" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "delete_file",
      description: "Delete a file in workspace",
      parameters: {
        type: "object",
        required: ["path"],
        properties: {
          path: { type: "string" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "search_in_files",
      description: "Search a plain text pattern across workspace files",
      parameters: {
        type: "object",
        required: ["pattern"],
        properties: {
          pattern: { type: "string" },
          glob: { type: "string" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "run_shell",
      description: "Run a shell command in workspace. Requires policy pass and explicit approval.",
      parameters: {
        type: "object",
        required: ["command"],
        properties: {
          command: { type: "string" },
          timeout_ms: { type: "number" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "user_question",
      description: "Request explicit user decision when uncertain. Use concise options.",
      parameters: {
        type: "object",
        required: ["title", "question", "options"],
        properties: {
          title: { type: "string" },
          question: { type: "string" },
          types: {
            type: "array",
            items: { type: "string" }
          },
          options: {
            type: "array",
            items: {
              type: "object",
              required: ["id", "label"],
              properties: {
                id: { type: "string" },
                label: { type: "string" },
                description: { type: "string" }
              }
            }
          },
          defaultType: { type: "string" },
          defaultOptionId: { type: "string" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "git_status",
      description: "Run git status --short --branch",
      parameters: {
        type: "object",
        properties: {}
      }
    }
  },
  {
    type: "function",
    function: {
      name: "git_diff",
      description: "Run git diff (optionally for specific file)",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "git_log",
      description: "Run git log --oneline with count",
      parameters: {
        type: "object",
        properties: {
          count: { type: "number" }
        }
      }
    }
  }
];

// src/agent.ts
var BASE_PROMPT = "You are HappyCode, a practical coding assistant. Prefer using tools for codebase-grounded answers. Keep responses concise, explicit, and actionable.";
function parseToolArgs(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
function toOpenAIMessages(messages, mode, cwd, systemPrompt, appendSystemPrompt) {
  const memoryPrompt = buildRuntimeMemoryPrompt(cwd);
  const mergedAppendPrompt = [appendSystemPrompt ?? "", memoryPrompt].filter(Boolean).join("\n\n");
  const merged = [
    BASE_PROMPT,
    systemPrompt ?? "",
    getModePrompt(mode),
    mergedAppendPrompt
  ].map((item) => item.trim()).filter(Boolean).join("\n\n");
  return [{ role: "system", content: merged }, ...messages];
}
function withMcpTools(mcpTools) {
  const extra = (mcpTools ?? []).map((item) => ({
    type: "function",
    function: {
      name: item.fullName,
      description: item.description || `MCP tool ${item.server}/${item.name}`,
      parameters: item.inputSchema ?? {
        type: "object",
        properties: {}
      }
    }
  }));
  return [...TOOL_SCHEMA, ...extra];
}
function filterTools(tools, allowedTools, disallowedTools) {
  const allow = new Set((allowedTools ?? []).map((item) => item.trim()).filter(Boolean));
  const deny = new Set((disallowedTools ?? []).map((item) => item.trim()).filter(Boolean));
  return tools.filter((item) => {
    const name = item.function.name;
    if (allow.size > 0 && !allow.has(name)) {
      return false;
    }
    if (deny.has(name)) {
      return false;
    }
    return true;
  });
}
var HappyCodeAgent = class {
  client;
  model;
  constructor(cfg) {
    this.client = new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl });
    this.model = cfg.model;
  }
  async chatStream(messages, options, onDelta, onToolEvent) {
    const wasAborted = () => options.abortSignal?.aborted === true;
    if (wasAborted()) {
      return "Interrupted by user.";
    }
    const maxTurns = options.maxTurns ?? 24;
    const running = toOpenAIMessages(
      messages,
      options.mode,
      options.cwd,
      options.systemPrompt,
      options.appendSystemPrompt
    );
    const mergedTools = withMcpTools(options.mcpTools);
    const tools = filterTools(mergedTools, options.allowedTools, options.disallowedTools);
    const model = options.model ?? this.model;
    const fallbackModel = options.fallbackModel;
    const createCompletion = async (completionMessages) => {
      try {
        return await this.client.chat.completions.create(
          {
            model,
            messages: completionMessages,
            tools,
            tool_choice: "auto"
          },
          options.abortSignal ? { signal: options.abortSignal } : void 0
        );
      } catch (err) {
        if (wasAborted()) {
          throw new Error("Interrupted by user.");
        }
        if (!fallbackModel) {
          throw err;
        }
        return await this.client.chat.completions.create(
          {
            model: fallbackModel,
            messages: completionMessages,
            tools,
            tool_choice: "auto"
          },
          options.abortSignal ? { signal: options.abortSignal } : void 0
        );
      }
    };
    for (let turn = 0; turn < maxTurns; turn += 1) {
      if (wasAborted()) {
        return "Interrupted by user.";
      }
      const completion = await createCompletion(running);
      const message = completion.choices[0]?.message;
      if (!message) {
        return "No response.";
      }
      if (!message.tool_calls || message.tool_calls.length === 0) {
        const content = message.content ?? "No content.";
        onDelta?.(content);
        return content;
      }
      running.push({
        role: "assistant",
        content: message.content,
        tool_calls: message.tool_calls
      });
      for (const toolCall of message.tool_calls) {
        if (wasAborted()) {
          return "Interrupted by user.";
        }
        if (toolCall.type !== "function") {
          continue;
        }
        const toolName = toolCall.function.name;
        const toolArgs = parseToolArgs(toolCall.function.arguments);
        onToolEvent?.({
          source: "model",
          phase: "start",
          name: toolName,
          args: toolArgs
        });
        let result = "";
        if (toolName.startsWith("mcp__")) {
          if (!options.mcpCall) {
            result = "MCP call unavailable in current runtime.";
          } else {
            try {
              result = await options.mcpCall(toolName, toolArgs);
            } catch (err) {
              result = `Tool error: ${err instanceof Error ? err.message : String(err)}`;
            }
          }
        } else {
          result = await runTool(
            {
              name: toolName,
              args: toolArgs
            },
            {
              mode: options.mode,
              cwd: options.cwd,
              enableAudit: options.enableAudit ?? true,
              abortSignal: options.abortSignal
            }
          );
        }
        if (wasAborted()) {
          return "Interrupted by user.";
        }
        let questionPayload;
        const isUserQuestion = result.startsWith(USER_QUESTION_PREFIX);
        const isApprovalQuestion = result.startsWith(APPROVAL_REQUIRED_PREFIX);
        if (isUserQuestion || isApprovalQuestion) {
          const raw = isUserQuestion ? result.slice(USER_QUESTION_PREFIX.length) : result.slice(APPROVAL_REQUIRED_PREFIX.length);
          try {
            questionPayload = JSON.parse(raw);
          } catch {
            questionPayload = void 0;
          }
          if (questionPayload && options.onUserQuestion) {
            try {
              const answer = await options.onUserQuestion(questionPayload);
              if (isApprovalQuestion) {
                const optionId = typeof answer.optionId === "string" ? answer.optionId : "";
                const shouldRetry = ["allow_once", "allow_session", "allow_global"].includes(optionId);
                if (shouldRetry) {
                  result = await runTool(
                    {
                      name: toolName,
                      args: toolArgs
                    },
                    {
                      mode: options.mode,
                      cwd: options.cwd,
                      enableAudit: options.enableAudit ?? true,
                      abortSignal: options.abortSignal
                    }
                  );
                } else {
                  result = JSON.stringify(
                    {
                      kind: "user_question_answer",
                      answer
                    },
                    null,
                    2
                  );
                }
              } else {
                result = JSON.stringify(
                  {
                    kind: "user_question_answer",
                    answer
                  },
                  null,
                  2
                );
              }
            } catch (err) {
              result = `Tool error: ${err instanceof Error ? err.message : String(err)}`;
            }
          } else if (questionPayload) {
            result = JSON.stringify(
              {
                kind: "user_question_required",
                message: "User decision required in interactive mode.",
                question: questionPayload
              },
              null,
              2
            );
          }
        }
        onToolEvent?.({
          source: "model",
          phase: "end",
          name: toolName,
          args: toolArgs,
          ok: !result.startsWith("Denied") && !result.startsWith("Tool error"),
          preview: result.slice(0, 180),
          questionPayload
        });
        running.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: result
        });
      }
    }
    return `Stopped after max tool turns (${maxTurns}). Increase --max-turns or split the task into smaller steps.`;
  }
};

// src/agents/agent_runner.ts
function summarizeOutput(raw) {
  const firstNonEmpty = raw.replace(/\r\n/g, "\n").split("\n").map((line) => line.trim()).find((line) => line.length > 0);
  return firstNonEmpty ? firstNonEmpty.slice(0, 220) : "(empty output)";
}
async function runIsolatedAgentTurn(agent, request, context, options) {
  const baseMessages = [...request.baseMessages ?? []];
  const output = await agent.chatStream(
    [...baseMessages, { role: "user", content: request.prompt }],
    {
      mode: request.mode,
      cwd: context.cwd,
      enableAudit: context.enableAudit,
      model: context.model,
      fallbackModel: context.fallbackModel,
      maxTurns: context.maxTurns ?? 12,
      allowedTools: context.allowedTools,
      disallowedTools: context.disallowedTools,
      systemPrompt: context.systemPrompt,
      appendSystemPrompt: [context.appendSystemPrompt ?? "", buildRuntimeMemoryPrompt(context.cwd)].filter(Boolean).join("\n\n"),
      mcpTools: options?.mcpTools,
      mcpCall: options?.mcpCall,
      onUserQuestion: options?.onUserQuestion,
      abortSignal: options?.abortSignal
    },
    options?.onDelta,
    options?.onToolEvent
  );
  return {
    role: request.role,
    name: request.name ?? request.role,
    mode: request.mode,
    prompt: request.prompt,
    output,
    summary: summarizeOutput(output),
    meta: {}
  };
}
function asNamedResult(result, role, name, meta) {
  return {
    ...result,
    role,
    name,
    meta
  };
}

// src/plan_runtime.ts
function stripFence(text) {
  return text.replace(/^```(?:markdown|md|text)?\s*/i, "").replace(/\s*```$/i, "").trim();
}
function buildPlannerPrompt(userPrompt) {
  return [
    "You are plan-agent. Produce an executable implementation plan only.",
    'Output only a top-level markdown todo checklist in this exact format: "- [ ] <task>".',
    "Top-level tasks must be 3-8 items, one-line, implementation-oriented, and coarse-grained.",
    "Do not output numbered lists, nested bullets, sections, commentary, or code fences.",
    "If scope is complex, keep top-level tasks coarse and let task-agent split/execute details later.",
    "Do not implement. Do not run commands. Do not write files.",
    `User goal:
${userPrompt}`
  ].join("\n\n");
}
function buildTaskAgentPrompt(snapshot) {
  const current = snapshot.items.find((item) => item.id === snapshot.currentTaskId) ?? snapshot.items.find((item) => item.status === "todo");
  const currentTaskText = current ? current.title : "Pick the highest-priority todo task.";
  return [
    "You are task-agent. Solve exactly one current task in this turn.",
    "Make concrete progress for that task only.",
    `Current task: ${currentTaskText}`,
    `Plan summary:
plan_id=${snapshot.planId} version=${snapshot.planVersion} phase=${snapshot.phase} progress=${snapshot.progress.done}/${snapshot.progress.total}`,
    "At the end, append TASK_STATE: done|blocked|doing and optional TASK_NOTE: <short note>."
  ].join("\n\n");
}
function parseReplanDecision(reply) {
  const normalized = reply.replace(/\r\n/g, "\n");
  const decisionMatch = normalized.match(/^REPLAN_DECISION:\s*(apply|skip)\s*$/im);
  const reasonMatch = normalized.match(/^REPLAN_REASON:\s*(.+)\s*$/im);
  const newPlanMatch = normalized.match(/NEW_PLAN:\s*([\s\S]*)$/im);
  const decision = decisionMatch?.[1]?.toLowerCase() ?? "skip";
  const reason = reasonMatch?.[1]?.trim() || "No significant drift detected.";
  const planText = newPlanMatch ? stripFence(newPlanMatch[1] ?? "") : void 0;
  const parseError = !decisionMatch ? "missing_decision" : !reasonMatch ? "missing_reason" : void 0;
  return {
    decision,
    reason,
    planText: planText && planText.length > 0 ? planText : void 0,
    raw: reply,
    parseError
  };
}

// src/agents/plan_agent.ts
async function runPlanAgent(agent, userGoal, context, options) {
  const result = await runIsolatedAgentTurn(
    agent,
    {
      role: "planner",
      name: "planner",
      mode: "plan",
      prompt: buildPlannerPrompt(userGoal)
    },
    context,
    options
  );
  return asNamedResult(result, "planner", "planner", {});
}

// src/plan_mode_state.ts
import fs7 from "fs";
import os6 from "os";
import path7 from "path";
var MIN_TOP_LEVEL_TASKS = 3;
var MAX_TOP_LEVEL_TASKS = 8;
var HAPPYCODE_ROOT = path7.join(os6.homedir(), ".happycode");
var PLANS_DIR = path7.join(HAPPYCODE_ROOT, "plans");
var TASKS_DIR = path7.join(HAPPYCODE_ROOT, "tasks");
var SNAPSHOT_DIR = path7.join(PLANS_DIR, ".snapshots");
var META_START = "<!-- HAPPYCODE_PLAN_META_START -->";
var META_END = "<!-- HAPPYCODE_PLAN_META_END -->";
function nowIso2() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function ensureStorageDirs() {
  fs7.mkdirSync(PLANS_DIR, { recursive: true });
  fs7.mkdirSync(TASKS_DIR, { recursive: true });
  fs7.mkdirSync(SNAPSHOT_DIR, { recursive: true });
}
function randomId2() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
function planMarkdownPath(planId) {
  return path7.join(PLANS_DIR, `${planId}.md`);
}
function planMetaPath(planId) {
  return path7.join(PLANS_DIR, `${planId}.meta.json`);
}
function taskSnapshotPath(planId) {
  return path7.join(TASKS_DIR, `${planId}.json`);
}
function taskEventsPath(planId) {
  return path7.join(TASKS_DIR, `${planId}.events.ndjson`);
}
function writeJson(filePath, payload) {
  fs7.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}
`, "utf8");
}
function appendTaskEvent(planId, event) {
  fs7.appendFileSync(taskEventsPath(planId), `${JSON.stringify(event)}
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
function extractProposedPlanBody(planText) {
  const match = planText.match(/<proposed_plan>\s*([\s\S]*?)\s*<\/proposed_plan>/i);
  return match ? match[1] : planText;
}
function extractStrictTodoItems(planText) {
  const body = extractProposedPlanBody(planText).replace(/\r\n/g, "\n");
  const lines = body.split("\n");
  const items = [];
  for (const rawLine of lines) {
    if (!rawLine.trim()) {
      continue;
    }
    if (rawLine !== rawLine.trimStart()) {
      continue;
    }
    const match = rawLine.match(/^[-*]\s+\[(?: |x|X|-)\]\s+(.+)$/);
    if (!match) {
      continue;
    }
    const title = match[1].trim().replace(/\s+/g, " ");
    if (title) {
      items.push(title);
    }
  }
  return Array.from(new Set(items));
}
function parsePlanTodoItems(planText) {
  const items = extractStrictTodoItems(planText);
  if (items.length === 0) {
    return {
      items: [],
      error: "invalid_todo_format",
      detail: 'No top-level markdown todo items found. Use "- [ ] <task>" lines.'
    };
  }
  if (items.length < MIN_TOP_LEVEL_TASKS) {
    return {
      items,
      error: "too_few_tasks",
      detail: `Expected at least ${MIN_TOP_LEVEL_TASKS} top-level tasks, got ${items.length}.`
    };
  }
  if (items.length > MAX_TOP_LEVEL_TASKS) {
    return {
      items,
      error: "too_many_tasks",
      detail: `Expected at most ${MAX_TOP_LEVEL_TASKS} top-level tasks, got ${items.length}.`
    };
  }
  return { items };
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
  lines.push(`- plan_version: ${meta.planVersion ?? 1}`);
  if (meta.lastReplanReason) {
    lines.push(`- last_replan_reason: ${meta.lastReplanReason}`);
  }
  if (meta.orchestratorStep) {
    lines.push(`- orchestrator_step: ${meta.orchestratorStep}`);
  }
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
        updatedAt: nowIso2()
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
  if (!fs7.existsSync(filePath)) {
    return null;
  }
  const body = fs7.readFileSync(filePath, "utf8");
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
  const existing = fs7.existsSync(filePath) ? fs7.readFileSync(filePath, "utf8") : "";
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
    const snapDir = path7.join(SNAPSHOT_DIR, planId);
    fs7.mkdirSync(snapDir, { recursive: true });
    const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[\:\.]/g, "-");
    fs7.writeFileSync(path7.join(snapDir, `${stamp}.md`), existing, "utf8");
    const snapshots = fs7.readdirSync(snapDir).filter((name) => name.endsWith(".md")).sort();
    if (snapshots.length > 20) {
      for (const old of snapshots.slice(0, snapshots.length - 20)) {
        fs7.unlinkSync(path7.join(snapDir, old));
      }
    }
  }
  fs7.writeFileSync(filePath, merged, "utf8");
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
    planVersion: Math.max(1, meta.planVersion ?? 1),
    lastReplanReason: meta.lastReplanReason,
    orchestratorStep: meta.orchestratorStep,
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
  if (fs7.existsSync(markdownFile)) {
    return false;
  }
  const legacyPath = taskSnapshotPath(planId);
  if (!fs7.existsSync(legacyPath)) {
    return false;
  }
  try {
    const legacy = JSON.parse(fs7.readFileSync(legacyPath, "utf8"));
    if (!legacy || !Array.isArray(legacy.items) || typeof legacy.sessionId !== "string") {
      return false;
    }
    ensureStorageDirs();
    const meta = {
      planId,
      sessionId: legacy.sessionId,
      phase: legacy.phase ?? "planning",
      planVersion: legacy.planVersion ?? 1,
      lastReplanReason: legacy.lastReplanReason,
      orchestratorStep: legacy.orchestratorStep,
      createdAt: legacy.createdAt ?? nowIso2(),
      updatedAt: legacy.updatedAt ?? nowIso2(),
      currentTaskId: legacy.currentTaskId,
      lastUpdatedTaskId: legacy.lastUpdatedTaskId
    };
    writePlanMarkdown(planId, meta, legacy.items, "migrated_from_json");
    appendTaskEvent(planId, {
      eventType: "migrated_from_json",
      planId,
      ts: nowIso2(),
      source: "migration"
    });
    return true;
  } catch {
    return false;
  }
}
function createPlanArtifactsDetailed(args) {
  const parsed = parsePlanTodoItems(args.planText);
  if (parsed.error) {
    return {
      ok: false,
      error: parsed.error,
      detail: parsed.detail ?? parsed.error
    };
  }
  const steps = parsed.items;
  ensureStorageDirs();
  const createdAt = nowIso2();
  const planId = args.planId ?? randomId2();
  const meta = {
    planId,
    sessionId: args.sessionId,
    phase: "planning",
    planVersion: 1,
    orchestratorStep: "planning",
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
    ok: true,
    value: {
      planId,
      snapshot
    }
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
    planVersion: snapshot.planVersion,
    lastReplanReason: snapshot.lastReplanReason,
    orchestratorStep: snapshot.orchestratorStep,
    createdAt: snapshot.createdAt,
    updatedAt: nowIso2(),
    currentTaskId: snapshot.currentTaskId,
    lastUpdatedTaskId: snapshot.lastUpdatedTaskId
  };
  const items = snapshot.items.map((item) => ({ ...item, updatedAt: item.updatedAt || meta.updatedAt }));
  writePlanMarkdown(snapshot.planId, meta, items, "snapshot_saved");
  const next = toSnapshot(meta, items);
  writeJson(taskSnapshotPath(snapshot.planId), next);
  return next;
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
  const ts = nowIso2();
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
  const ts = nowIso2();
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

// src/agents/task_agent.ts
async function runTaskAgent(agent, snapshot, mode, context, options) {
  const result = await runIsolatedAgentTurn(
    agent,
    {
      role: "tasker",
      name: "tasker",
      mode,
      prompt: buildTaskAgentPrompt(snapshot)
    },
    context,
    options
  );
  const parsed = parseTaskOutcomeFromAssistantReply(result.output);
  const meta = parsed ? { taskStateDelta: parsed } : { parseError: "missing_task_state_control_line" };
  return asNamedResult(result, "tasker", "tasker", meta);
}

// src/agents/reviewer_agent.ts
var REVIEWER_PROMPT = "Review the proposed approach and list potential issues.";
async function runReviewerAgent(agent, context, basePrompt, options) {
  const prompt = basePrompt ? `${basePrompt}

${REVIEWER_PROMPT}` : REVIEWER_PROMPT;
  const result = await runIsolatedAgentTurn(
    agent,
    {
      role: "reviewer",
      name: "reviewer",
      mode: "plan",
      prompt
    },
    context,
    options
  );
  return asNamedResult(result, "reviewer", "reviewer", {});
}

// src/agents/coder_agent.ts
var CODER_PROMPT = "Provide concrete code-level changes to implement the request.";
async function runCoderAgent(agent, context, basePrompt, options) {
  const prompt = basePrompt ? `${basePrompt}

${CODER_PROMPT}` : CODER_PROMPT;
  const result = await runIsolatedAgentTurn(
    agent,
    {
      role: "coder",
      name: "coder",
      mode: "edit",
      prompt
    },
    context,
    options
  );
  return asNamedResult(result, "coder", "coder", {});
}

// src/agents/orchestrator.ts
async function runTriadReview(agent, basePrompt, context, options) {
  const planner = await runPlanAgent(agent, basePrompt, context, options);
  const coder = await runCoderAgent(agent, context, basePrompt, {
    ...options,
    onDelta: void 0,
    onToolEvent: void 0,
    onUserQuestion: options?.onUserQuestion
  });
  const reviewer = await runReviewerAgent(agent, context, basePrompt, {
    ...options,
    onDelta: void 0,
    onToolEvent: void 0,
    onUserQuestion: options?.onUserQuestion
  });
  return [planner, coder, reviewer];
}

// src/config.ts
import fs8 from "fs";
import os7 from "os";
import path8 from "path";
var DEFAULT_MAX_TURNS = 24;
var MIN_MAX_TURNS = 1;
var MAX_MAX_TURNS = 200;
function parseMaxTurns(value) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : Number.NaN;
  if (!Number.isFinite(parsed)) {
    return DEFAULT_MAX_TURNS;
  }
  return Math.max(MIN_MAX_TURNS, Math.min(MAX_MAX_TURNS, Math.trunc(parsed)));
}
var CONFIG_DIR = path8.join(os7.homedir(), ".happycode");
var CONFIG_PATH = path8.join(CONFIG_DIR, "config.json");
function getConfigPath() {
  return CONFIG_PATH;
}
function ensureConfigDir() {
  fs8.mkdirSync(CONFIG_DIR, { recursive: true });
}
function readConfig() {
  if (!fs8.existsSync(CONFIG_PATH)) {
    return null;
  }
  const raw = fs8.readFileSync(CONFIG_PATH, "utf8");
  const normalized = raw.charCodeAt(0) === 65279 ? raw.slice(1) : raw;
  const parsed = JSON.parse(normalized);
  if (!parsed.baseUrl || !parsed.apiKey) {
    return null;
  }
  return {
    baseUrl: parsed.baseUrl,
    apiKey: parsed.apiKey,
    model: parsed.model ?? "gpt-4o-mini",
    maxTurns: parseMaxTurns(parsed.maxTurns)
  };
}
function writeConfig(config) {
  ensureConfigDir();
  fs8.writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}
`, "utf8");
}

export {
  getMemoryPath,
  getProjectMemoryPath,
  ensureMemoryFile,
  openMemoryFile,
  getModePolicy,
  getModePrompt,
  SUPPORTED_MODES,
  getAuditPath,
  readRecentAudit,
  getApprovalPath,
  allowGlobalCommandPrefix,
  clearGlobalCommandApprovals,
  isGloballyApprovedCommand,
  getGlobalApprovalPrefixes,
  getPolicyPath,
  getGlobalPolicyPath,
  loadPolicy,
  writeDefaultPolicy,
  writeDefaultGlobalPolicy,
  getSessionRootPath,
  getLegacySessionPath,
  createSession,
  loadSessionById,
  listSessions,
  loadActiveSession,
  loadSessionMessages,
  saveSessionMessages,
  loadSessionToolEvents,
  saveSessionToolEvents,
  clearSession,
  getInputHistory,
  appendInputHistoryEntry,
  bindPlanToActiveSession,
  setActiveSessionPlanPhase,
  setActiveSessionPlanRuntimeState,
  clearActiveSessionPlanBinding,
  renameActiveSession,
  forkActiveSession,
  rewindActiveSession,
  switchSession,
  approveCommandForSession,
  approveCommandOnce,
  listSessionApprovals,
  clearSessionApprovals,
  HappyCodeAgent,
  runIsolatedAgentTurn,
  parseReplanDecision,
  runPlanAgent,
  MAX_TOP_LEVEL_TASKS,
  createPlanArtifactsDetailed,
  loadTaskSnapshot,
  updateCurrentTaskOutcome,
  ensureSolvingTaskConsistency,
  parseTaskOutcomeFromAssistantReply,
  runTaskAgent,
  runReviewerAgent,
  runCoderAgent,
  runTriadReview,
  getConfigPath,
  readConfig,
  writeConfig
};
