import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { ChatMessage } from './agent.js';

export type SessionToolEvent = {
  source: 'model' | 'runtime';
  phase: 'start' | 'end';
  name: string;
  args: Record<string, unknown>;
  ok?: boolean;
  preview?: string;
  seq: number;
  ts: number;
  turn: number;
};

export type SessionRecord = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  toolEvents: SessionToolEvent[];
  sessionApprovedCommandPrefixes?: string[];
  oneTimeApprovedCommands?: string[];
  projectKey?: string;
  projectRoot?: string;
  activePlanId?: string;
  activeTaskSetId?: string;
  planSolvePhase?: 'planning' | 'solving' | 'completed' | 'paused';
  activePlanVersion?: number;
  lastOrchestratorStep?: 'planning' | 'tasking' | 'replanning';
  inputHistory?: InputHistoryEntry[];
};

export type InputHistoryEntry = {
  id: string;
  text: string;
  createdAt: string;
};

const SESSION_ROOT = path.join(os.homedir(), '.happycode', 'sessions');
const ACTIVE_FILE = path.join(SESSION_ROOT, 'active-session.txt');
const ACTIVE_MAP_FILE = path.join(SESSION_ROOT, 'active-sessions.json');

function ensureDir(): void {
  fs.mkdirSync(SESSION_ROOT, { recursive: true });
}

function safeName(input: string): string {
  return input.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60) || 'session';
}

function resolveProjectRoot(cwd: string): string {
  const target = path.resolve(cwd);
  try {
    return fs.realpathSync(target);
  } catch {
    return target;
  }
}

function toProjectKey(projectRoot: string): string {
  const normalized = process.platform === 'win32' ? projectRoot.toLowerCase() : projectRoot;
  return createHash('sha1').update(normalized).digest('hex').slice(0, 16);
}

function projectMetaFromCwd(cwd: string): { projectRoot: string; projectKey: string } {
  const projectRoot = resolveProjectRoot(cwd);
  return {
    projectRoot,
    projectKey: toProjectKey(projectRoot)
  };
}

function normalizeRecord(record: SessionRecord): SessionRecord {
  return {
    ...record,
    toolEvents: Array.isArray(record.toolEvents) ? record.toolEvents : [],
    sessionApprovedCommandPrefixes: Array.isArray(record.sessionApprovedCommandPrefixes)
      ? record.sessionApprovedCommandPrefixes
      : [],
    oneTimeApprovedCommands: Array.isArray(record.oneTimeApprovedCommands) ? record.oneTimeApprovedCommands : [],
    planSolvePhase: record.planSolvePhase ?? 'planning',
    activePlanVersion: typeof record.activePlanVersion === 'number' ? record.activePlanVersion : 1,
    lastOrchestratorStep: record.lastOrchestratorStep ?? 'planning',
    inputHistory: normalizeInputHistory(record.inputHistory)
  };
}

function readActiveMap(): Record<string, string> {
  ensureDir();
  if (!fs.existsSync(ACTIVE_MAP_FILE)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(ACTIVE_MAP_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeActiveMap(map: Record<string, string>): void {
  ensureDir();
  fs.writeFileSync(ACTIVE_MAP_FILE, `${JSON.stringify(map, null, 2)}\n`, 'utf8');
}

function isProjectMatch(record: SessionRecord, projectKey: string): boolean {
  return !record.projectKey || record.projectKey === projectKey;
}

function sessionPathById(id: string): string {
  return path.join(SESSION_ROOT, `${id}.json`);
}

function nowIso(): string {
  return new Date().toISOString();
}

function randomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeInputHistory(entries: unknown): InputHistoryEntry[] {
  if (!Array.isArray(entries)) {
    return [];
  }

  const now = nowIso();
  const normalized: InputHistoryEntry[] = [];
  for (const item of entries) {
    if (typeof item === 'string') {
      const text = item.trim();
      if (text) {
        normalized.push({
          id: randomId(),
          text,
          createdAt: now
        });
      }
      continue;
    }
    if (!item || typeof item !== 'object') {
      continue;
    }
    const candidate = item as Record<string, unknown>;
    const text = typeof candidate.text === 'string' ? candidate.text.trim() : '';
    if (!text) {
      continue;
    }
    normalized.push({
      id: typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id : randomId(),
      text,
      createdAt: typeof candidate.createdAt === 'string' && candidate.createdAt.trim() ? candidate.createdAt : now
    });
  }

  return normalized.slice(-100);
}

export function getSessionRootPath(): string {
  ensureDir();
  return SESSION_ROOT;
}

export function getLegacySessionPath(): string {
  return path.join(os.homedir(), '.happycode', 'session.json');
}

export function createSession(name = 'default', cwd = process.cwd()): SessionRecord {
  ensureDir();
  const meta = projectMetaFromCwd(cwd);
  const id = randomId();
  const record: SessionRecord = {
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
    planSolvePhase: 'planning',
    inputHistory: []
  };
  saveSessionRecord(record);
  setActiveSessionId(id, cwd);
  return record;
}

export function saveSessionRecord(record: SessionRecord): void {
  ensureDir();
  const next: SessionRecord = {
    ...record,
    name: safeName(record.name),
    toolEvents: Array.isArray(record.toolEvents) ? record.toolEvents : [],
    sessionApprovedCommandPrefixes: Array.isArray(record.sessionApprovedCommandPrefixes)
      ? record.sessionApprovedCommandPrefixes
      : [],
    oneTimeApprovedCommands: Array.isArray(record.oneTimeApprovedCommands) ? record.oneTimeApprovedCommands : [],
    planSolvePhase: record.planSolvePhase ?? 'planning',
    inputHistory: normalizeInputHistory(record.inputHistory),
    updatedAt: nowIso()
  };
  fs.writeFileSync(sessionPathById(next.id), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}

export function loadSessionById(id: string): SessionRecord | null {
  const p = sessionPathById(id);
  if (!fs.existsSync(p)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw) as SessionRecord;
    if (!parsed || !Array.isArray(parsed.messages)) {
      return null;
    }
    return normalizeRecord(parsed);
  } catch {
    return null;
  }
}

export function listSessions(cwd = process.cwd()): SessionRecord[] {
  ensureDir();
  const { projectKey } = projectMetaFromCwd(cwd);
  const files = fs
    .readdirSync(SESSION_ROOT)
    .filter((item) => item.endsWith('.json'))
    .map((item) => path.join(SESSION_ROOT, item));

  const sessions: SessionRecord[] = [];
  for (const file of files) {
    try {
      const raw = fs.readFileSync(file, 'utf8');
      const parsed = JSON.parse(raw) as SessionRecord;
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

export function setActiveSessionId(id: string, cwd = process.cwd()): void {
  ensureDir();
  const { projectKey } = projectMetaFromCwd(cwd);
  const map = readActiveMap();
  map[projectKey] = id;
  writeActiveMap(map);
  fs.writeFileSync(ACTIVE_FILE, `${id}\n`, 'utf8');
}

export function getActiveSessionId(cwd = process.cwd()): string | null {
  const { projectKey } = projectMetaFromCwd(cwd);
  const map = readActiveMap();
  const scoped = map[projectKey];
  if (scoped) {
    return scoped;
  }

  if (fs.existsSync(ACTIVE_FILE)) {
    try {
      const legacyId = fs.readFileSync(ACTIVE_FILE, 'utf8').trim();
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

export function loadActiveSession(cwd = process.cwd()): SessionRecord {
  const { projectKey } = projectMetaFromCwd(cwd);
  const id = getActiveSessionId(cwd);
  if (id) {
    const record = loadSessionById(id);
    if (record && isProjectMatch(record, projectKey)) {
      return record;
    }
  }
  return createSession('default', cwd);
}

export function loadSessionMessages(cwd = process.cwd()): ChatMessage[] {
  const active = loadActiveSession(cwd);
  return active.messages;
}

export function saveSessionMessages(messages: ChatMessage[], cwd = process.cwd()): void {
  const active = loadActiveSession(cwd);
  active.messages = messages;
  saveSessionRecord(active);
}

export function loadSessionToolEvents(cwd = process.cwd()): SessionToolEvent[] {
  const active = loadActiveSession(cwd);
  return active.toolEvents;
}

export function saveSessionToolEvents(events: SessionToolEvent[], cwd = process.cwd()): void {
  const active = loadActiveSession(cwd);
  active.toolEvents = events;
  saveSessionRecord(active);
}

export function clearSession(cwd = process.cwd()): void {
  const active = loadActiveSession(cwd);
  active.messages = [];
  active.toolEvents = [];
  saveSessionRecord(active);
}

export function getInputHistory(cwd = process.cwd()): InputHistoryEntry[] {
  const active = loadActiveSession(cwd);
  return active.inputHistory ?? [];
}

export function appendInputHistoryEntry(entry: string, cwd = process.cwd()): InputHistoryEntry[] {
  const normalized = entry.trim();
  if (!normalized) {
    return getInputHistory(cwd);
  }
  const active = loadActiveSession(cwd);
  const history = active.inputHistory ?? [];
  if (history[history.length - 1]?.text === normalized) {
    return history;
  }
  const next: InputHistoryEntry[] = [
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

export function appendInputHistory(entry: string, cwd = process.cwd()): string[] {
  return appendInputHistoryEntry(entry, cwd).map((item) => item.text);
}

export function getInputHistoryTexts(cwd = process.cwd()): string[] {
  return getInputHistory(cwd).map((item) => item.text);
}

export function bindPlanToActiveSession(
  planId: string,
  taskSetId: string,
  phase: 'planning' | 'solving' | 'completed' | 'paused' = 'planning',
  cwd = process.cwd()
): SessionRecord {
  const active = loadActiveSession(cwd);
  active.activePlanId = planId;
  active.activeTaskSetId = taskSetId;
  active.planSolvePhase = phase;
  active.activePlanVersion = active.activePlanVersion ?? 1;
  active.lastOrchestratorStep = phase === 'solving' ? 'tasking' : 'planning';
  saveSessionRecord(active);
  return active;
}

export function setActiveSessionPlanPhase(
  phase: 'planning' | 'solving' | 'completed' | 'paused',
  cwd = process.cwd()
): SessionRecord {
  const active = loadActiveSession(cwd);
  active.planSolvePhase = phase;
  active.lastOrchestratorStep = phase === 'solving' ? 'tasking' : phase === 'planning' ? 'planning' : active.lastOrchestratorStep;
  saveSessionRecord(active);
  return active;
}

export function setActiveSessionPlanRuntimeState(
  state: { planVersion?: number; orchestratorStep?: 'planning' | 'tasking' | 'replanning' },
  cwd = process.cwd()
): SessionRecord {
  const active = loadActiveSession(cwd);
  if (typeof state.planVersion === 'number' && Number.isFinite(state.planVersion)) {
    active.activePlanVersion = Math.max(1, Math.floor(state.planVersion));
  }
  if (state.orchestratorStep) {
    active.lastOrchestratorStep = state.orchestratorStep;
  }
  saveSessionRecord(active);
  return active;
}

export function clearActiveSessionPlanBinding(cwd = process.cwd()): SessionRecord {
  const active = loadActiveSession(cwd);
  delete active.activePlanId;
  delete active.activeTaskSetId;
  delete active.activePlanVersion;
  delete active.lastOrchestratorStep;
  active.planSolvePhase = 'planning';
  saveSessionRecord(active);
  return active;
}

export function renameActiveSession(name: string, cwd = process.cwd()): SessionRecord {
  const active = loadActiveSession(cwd);
  active.name = safeName(name);
  saveSessionRecord(active);
  return active;
}

export function forkActiveSession(name?: string, cwd = process.cwd()): SessionRecord {
  const active = loadActiveSession(cwd);
  const clone: SessionRecord = {
    id: randomId(),
    name: safeName(name ?? `${active.name}_fork`),
    createdAt: nowIso(),
    updatedAt: nowIso(),
    messages: [...active.messages],
    toolEvents: [...active.toolEvents],
    sessionApprovedCommandPrefixes: [...(active.sessionApprovedCommandPrefixes ?? [])],
    oneTimeApprovedCommands: [],
    projectKey: active.projectKey,
    projectRoot: active.projectRoot,
    activePlanId: active.activePlanId,
    activeTaskSetId: active.activeTaskSetId,
    planSolvePhase: active.planSolvePhase ?? 'planning',
    activePlanVersion: active.activePlanVersion,
    lastOrchestratorStep: active.lastOrchestratorStep,
    inputHistory: [...(active.inputHistory ?? [])]
  };
  saveSessionRecord(clone);
  setActiveSessionId(clone.id, cwd);
  return clone;
}

export function rewindActiveSession(steps: number, cwd = process.cwd()): SessionRecord {
  const active = loadActiveSession(cwd);
  const drop = Math.max(1, steps);
  const nextMessages = active.messages.slice(0, Math.max(0, active.messages.length - drop));
  const remainingUserTurns = nextMessages.filter((item) => item.role === 'user').length;
  active.messages = nextMessages;
  active.toolEvents = active.toolEvents.filter((item) => item.turn <= remainingUserTurns);
  saveSessionRecord(active);
  return active;
}

export function switchSession(id: string, cwd = process.cwd()): SessionRecord | null {
  const { projectKey } = projectMetaFromCwd(cwd);
  const target = loadSessionById(id);
  if (!target || !isProjectMatch(target, projectKey)) {
    return null;
  }
  setActiveSessionId(id, cwd);
  return target;
}

function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function approveCommandForSession(prefix: string, cwd = process.cwd()): void {
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

export function approveCommandOnce(command: string, cwd = process.cwd()): void {
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

export function consumeOneTimeApproval(command: string, cwd = process.cwd()): boolean {
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

export function isSessionApprovedCommand(command: string, cwd = process.cwd()): boolean {
  const normalized = normalizeCommand(command);
  const active = loadActiveSession(cwd);
  const list = active.sessionApprovedCommandPrefixes ?? [];
  return list.some((prefix) => normalized.startsWith(prefix));
}

export function listSessionApprovals(
  cwd = process.cwd()
): { once: string[]; session: string[] } {
  const active = loadActiveSession(cwd);
  return {
    once: active.oneTimeApprovedCommands ?? [],
    session: active.sessionApprovedCommandPrefixes ?? []
  };
}

export function clearSessionApprovals(cwd = process.cwd()): void {
  const active = loadActiveSession(cwd);
  active.oneTimeApprovedCommands = [];
  active.sessionApprovedCommandPrefixes = [];
  saveSessionRecord(active);
}
