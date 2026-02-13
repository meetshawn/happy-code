import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type PlanSolvePhase = 'planning' | 'solving' | 'completed' | 'paused';
export type TaskStatus = 'todo' | 'doing' | 'done' | 'blocked';

export type TaskItem = {
  id: string;
  title: string;
  status: TaskStatus;
  notes?: string;
  attempts?: number;
  startedAt?: string;
  completedAt?: string;
  blockedReason?: string;
  updatedAt: string;
};

export type TaskStateSnapshot = {
  planId: string;
  sessionId: string;
  phase: PlanSolvePhase;
  planVersion: number;
  lastReplanReason?: string;
  orchestratorStep?: 'planning' | 'tasking' | 'replanning';
  items: TaskItem[];
  progress: {
    done: number;
    total: number;
    percent: number;
  };
  currentTaskId?: string;
  lastUpdatedTaskId?: string;
  blockedCount: number;
  stats: {
    total: number;
    todo: number;
    doing: number;
    done: number;
    blocked: number;
  };
  createdAt: string;
  updatedAt: string;
};

type TaskEvent = {
  eventType:
    | 'plan_created'
    | 'phase_changed'
    | 'replan_requested'
    | 'replan_applied'
    | 'replan_skipped'
    | 'subagent_turn_started'
    | 'subagent_turn_finished'
    | 'subagent_output_parsed'
    | 'subagent_output_parse_failed'
    | 'orchestrator_transition'
    | 'task_agent_turn_started'
    | 'task_agent_turn_finished'
    | 'task_started'
    | 'task_completed'
    | 'task_blocked'
    | 'task_unblocked'
    | 'task_note_updated'
    | 'migrated_from_json';
  planId: string;
  ts: string;
  source: string;
  taskId?: string;
  from?: string;
  to?: string;
  note?: string;
};

export type PlanPersistResult = {
  planId: string;
  snapshot: TaskStateSnapshot;
};

export type PlanParseError = 'invalid_todo_format' | 'too_few_tasks' | 'too_many_tasks';

export type PlanParseResult = {
  items: string[];
  error?: PlanParseError;
  detail?: string;
};

export type PlanPersistDetailedResult =
  | {
      ok: true;
      value: PlanPersistResult;
    }
  | {
      ok: false;
      error: PlanParseError;
      detail: string;
    };

export const MIN_TOP_LEVEL_TASKS = 3;
export const MAX_TOP_LEVEL_TASKS = 8;

const HAPPYCODE_ROOT = path.join(os.homedir(), '.happycode');
const PLANS_DIR = path.join(HAPPYCODE_ROOT, 'plans');
const TASKS_DIR = path.join(HAPPYCODE_ROOT, 'tasks');
const SNAPSHOT_DIR = path.join(PLANS_DIR, '.snapshots');

const META_START = '<!-- HAPPYCODE_PLAN_META_START -->';
const META_END = '<!-- HAPPYCODE_PLAN_META_END -->';

type PlanMeta = {
  planId: string;
  sessionId: string;
  phase: PlanSolvePhase;
  planVersion?: number;
  lastReplanReason?: string;
  orchestratorStep?: 'planning' | 'tasking' | 'replanning';
  createdAt: string;
  updatedAt: string;
  sourcePrompt?: string;
  currentTaskId?: string;
  lastUpdatedTaskId?: string;
};

type ParsedPlan = {
  meta: PlanMeta;
  items: TaskItem[];
  bodyLines: string[];
};

function nowIso(): string {
  return new Date().toISOString();
}

function ensureStorageDirs(): void {
  fs.mkdirSync(PLANS_DIR, { recursive: true });
  fs.mkdirSync(TASKS_DIR, { recursive: true });
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
}

function randomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function planMarkdownPath(planId: string): string {
  return path.join(PLANS_DIR, `${planId}.md`);
}

function planMetaPath(planId: string): string {
  return path.join(PLANS_DIR, `${planId}.meta.json`);
}

function taskSnapshotPath(planId: string): string {
  return path.join(TASKS_DIR, `${planId}.json`);
}

function taskEventsPath(planId: string): string {
  return path.join(TASKS_DIR, `${planId}.events.ndjson`);
}

function writeJson(filePath: string, payload: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function appendTaskEvent(planId: string, event: TaskEvent): void {
  fs.appendFileSync(taskEventsPath(planId), `${JSON.stringify(event)}\n`, 'utf8');
}

export function recordTaskEvent(
  planId: string,
  event: Omit<TaskEvent, 'planId' | 'ts'> & { ts?: string }
): void {
  ensureStorageDirs();
  appendTaskEvent(planId, {
    ...event,
    planId,
    ts: event.ts ?? nowIso()
  });
}

function computeStats(items: TaskItem[]): TaskStateSnapshot['stats'] {
  return {
    total: items.length,
    todo: items.filter((item) => item.status === 'todo').length,
    doing: items.filter((item) => item.status === 'doing').length,
    done: items.filter((item) => item.status === 'done').length,
    blocked: items.filter((item) => item.status === 'blocked').length
  };
}

function computeProgress(items: TaskItem[]): TaskStateSnapshot['progress'] {
  const total = items.length;
  const done = items.filter((item) => item.status === 'done').length;
  const percent = total > 0 ? Number(((done / total) * 100).toFixed(1)) : 0;
  return {
    done,
    total,
    percent
  };
}

function findCurrentTaskId(items: TaskItem[]): string | undefined {
  return items.find((item) => item.status === 'doing')?.id;
}

function extractProposedPlanBody(planText: string): string {
  const match = planText.match(/<proposed_plan>\s*([\s\S]*?)\s*<\/proposed_plan>/i);
  return match ? match[1] : planText;
}

export function extractStrictTodoItems(planText: string): string[] {
  const body = extractProposedPlanBody(planText).replace(/\r\n/g, '\n');
  const lines = body.split('\n');
  const items: string[] = [];
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
    const title = match[1].trim().replace(/\s+/g, ' ');
    if (title) {
      items.push(title);
    }
  }
  return Array.from(new Set(items));
}

export function parsePlanTodoItems(planText: string): PlanParseResult {
  const items = extractStrictTodoItems(planText);
  if (items.length === 0) {
    return {
      items: [],
      error: 'invalid_todo_format',
      detail: 'No top-level markdown todo items found. Use "- [ ] <task>" lines.'
    };
  }
  if (items.length < MIN_TOP_LEVEL_TASKS) {
    return {
      items,
      error: 'too_few_tasks',
      detail: `Expected at least ${MIN_TOP_LEVEL_TASKS} top-level tasks, got ${items.length}.`
    };
  }
  if (items.length > MAX_TOP_LEVEL_TASKS) {
    return {
      items,
      error: 'too_many_tasks',
      detail: `Expected at most ${MAX_TOP_LEVEL_TASKS} top-level tasks, got ${items.length}.`
    };
  }
  return { items };
}

function statusToCheckbox(status: TaskStatus): '[ ]' | '[x]' | '[-]' {
  if (status === 'done') {
    return '[x]';
  }
  if (status === 'doing') {
    return '[-]';
  }
  return '[ ]';
}

function checkboxToStatus(checkbox: string, blockedReason?: string): TaskStatus {
  if (checkbox === '[x]') {
    return 'done';
  }
  if (checkbox === '[-]') {
    return 'doing';
  }
  return blockedReason ? 'blocked' : 'todo';
}

function renderPlanMarkdown(meta: PlanMeta, items: TaskItem[]): string {
  const lines: string[] = [];
  lines.push(`# Task Plan: ${meta.planId}`);
  lines.push('');
  lines.push(META_START);
  lines.push(JSON.stringify(meta, null, 2));
  lines.push(META_END);
  lines.push('');
  lines.push('## Meta');
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
  lines.push('');
  lines.push('## Steps');
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
  lines.push('');
  lines.push('## Execution Log');
  lines.push('- initialized');
  lines.push('');
  return `${lines.join('\n')}`;
}

function parseMetaBlock(markdown: string): PlanMeta | null {
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
    const parsed = JSON.parse(body) as PlanMeta;
    if (!parsed || typeof parsed.planId !== 'string') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function parseItems(markdown: string): TaskItem[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const items: TaskItem[] = [];
  let current: TaskItem | null = null;
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const stepMatch = line.match(/^\s*[-*]\s*(\[[ xX\-]\])\s+(task_\d+)\s+(.+)$/);
    if (stepMatch) {
      const checkbox = stepMatch[1].toLowerCase() === '[x]' ? '[x]' : stepMatch[1] === '[-]' ? '[-]' : '[ ]';
      const item: TaskItem = {
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
      current.status = 'blocked';
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

function parsePlanMarkdown(planId: string): ParsedPlan | null {
  const filePath = planMarkdownPath(planId);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const body = fs.readFileSync(filePath, 'utf8');
  const meta = parseMetaBlock(body);
  if (!meta) {
    return null;
  }
  const items = parseItems(body);
  const bodyLines = body.replace(/\r\n/g, '\n').split('\n');
  return {
    meta,
    items,
    bodyLines
  };
}

function writePlanMarkdown(planId: string, meta: PlanMeta, items: TaskItem[], logLine?: string): void {
  const filePath = planMarkdownPath(planId);
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  const next = renderPlanMarkdown(meta, items);

  const logSegment = existing.includes('## Execution Log')
    ? existing.slice(existing.indexOf('## Execution Log')).split('\n').slice(1).filter((line) => line.trim().length > 0)
    : [];
  if (logLine) {
    logSegment.push(`- ${logLine}`);
  }

  const merged = `${next.replace(/\n\s*## Execution Log\n- initialized\n?\s*$/m, '')}\n## Execution Log\n${
    logSegment.length > 0 ? logSegment.join('\n') : '- initialized'
  }\n`;

  if (existing) {
    const snapDir = path.join(SNAPSHOT_DIR, planId);
    fs.mkdirSync(snapDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[\:\.]/g, '-');
    fs.writeFileSync(path.join(snapDir, `${stamp}.md`), existing, 'utf8');
    const snapshots = fs
      .readdirSync(snapDir)
      .filter((name) => name.endsWith('.md'))
      .sort();
    if (snapshots.length > 20) {
      for (const old of snapshots.slice(0, snapshots.length - 20)) {
        fs.unlinkSync(path.join(snapDir, old));
      }
    }
  }

  fs.writeFileSync(filePath, merged, 'utf8');
}

function toSnapshot(meta: PlanMeta, items: TaskItem[]): TaskStateSnapshot {
  const normalizedItems = items.map((item) => ({
    ...item,
    status: item.blockedReason ? (item.status === 'done' ? 'done' : 'blocked') : item.status
  }));
  const stats = computeStats(normalizedItems);
  const progress = computeProgress(normalizedItems);
  const phase: PlanSolvePhase =
    meta.phase !== 'completed' && progress.total > 0 && progress.done === progress.total && stats.blocked === 0
      ? 'completed'
      : meta.phase;
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

function migrateLegacyJsonIfNeeded(planId: string): boolean {
  const markdownFile = planMarkdownPath(planId);
  if (fs.existsSync(markdownFile)) {
    return false;
  }
  const legacyPath = taskSnapshotPath(planId);
  if (!fs.existsSync(legacyPath)) {
    return false;
  }
  try {
    const legacy = JSON.parse(fs.readFileSync(legacyPath, 'utf8')) as TaskStateSnapshot;
    if (!legacy || !Array.isArray(legacy.items) || typeof legacy.sessionId !== 'string') {
      return false;
    }
    ensureStorageDirs();
    const meta: PlanMeta = {
      planId,
      sessionId: legacy.sessionId,
      phase: legacy.phase ?? 'planning',
      planVersion: legacy.planVersion ?? 1,
      lastReplanReason: legacy.lastReplanReason,
      orchestratorStep: legacy.orchestratorStep,
      createdAt: legacy.createdAt ?? nowIso(),
      updatedAt: legacy.updatedAt ?? nowIso(),
      currentTaskId: legacy.currentTaskId,
      lastUpdatedTaskId: legacy.lastUpdatedTaskId
    };
    writePlanMarkdown(planId, meta, legacy.items, 'migrated_from_json');
    appendTaskEvent(planId, {
      eventType: 'migrated_from_json',
      planId,
      ts: nowIso(),
      source: 'migration'
    });
    return true;
  } catch {
    return false;
  }
}

export function createPlanArtifactsDetailed(args: {
  sessionId: string;
  planText: string;
  sourcePrompt: string;
  planId?: string;
}): PlanPersistDetailedResult {
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
  const createdAt = nowIso();
  const planId = args.planId ?? randomId();
  const meta: PlanMeta = {
    planId,
    sessionId: args.sessionId,
    phase: 'planning',
    planVersion: 1,
    orchestratorStep: 'planning',
    createdAt,
    updatedAt: createdAt,
    sourcePrompt: args.sourcePrompt
  };

  const items: TaskItem[] = steps.map((title, index) => ({
    id: `task_${index + 1}`,
    title,
    status: 'todo',
    updatedAt: createdAt
  }));

  writeJson(planMetaPath(planId), {
    ...meta,
    sourcePrompt: args.sourcePrompt
  });
  writePlanMarkdown(planId, meta, items, 'plan_created');
  appendTaskEvent(planId, {
    eventType: 'plan_created',
    planId,
    ts: createdAt,
    source: 'mode_plan'
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

export function createPlanArtifacts(args: {
  sessionId: string;
  planText: string;
  sourcePrompt: string;
  planId?: string;
}): PlanPersistResult | null {
  const detailed = createPlanArtifactsDetailed(args);
  return detailed.ok ? detailed.value : null;
}

export function loadTaskSnapshot(planId: string): TaskStateSnapshot | null {
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

export function saveTaskSnapshot(snapshot: TaskStateSnapshot): TaskStateSnapshot {
  ensureStorageDirs();
  const meta: PlanMeta = {
    planId: snapshot.planId,
    sessionId: snapshot.sessionId,
    phase: snapshot.phase,
    planVersion: snapshot.planVersion,
    lastReplanReason: snapshot.lastReplanReason,
    orchestratorStep: snapshot.orchestratorStep,
    createdAt: snapshot.createdAt,
    updatedAt: nowIso(),
    currentTaskId: snapshot.currentTaskId,
    lastUpdatedTaskId: snapshot.lastUpdatedTaskId
  };
  const items = snapshot.items.map((item) => ({ ...item, updatedAt: item.updatedAt || meta.updatedAt }));
  writePlanMarkdown(snapshot.planId, meta, items, 'snapshot_saved');
  const next = toSnapshot(meta, items);
  writeJson(taskSnapshotPath(snapshot.planId), next);
  return next;
}

export function enterSolvingPhase(planId: string, source = 'ui'): TaskStateSnapshot | null {
  const snapshot = loadTaskSnapshot(planId);
  if (!snapshot) {
    return null;
  }

  const ts = nowIso();
  const items = snapshot.items.map((item) => ({ ...item }));
  let currentTaskId = snapshot.currentTaskId;
  const existingDoing = items.find((item) => item.status === 'doing');
  if (!existingDoing) {
    const firstTodo = items.find((item) => item.status === 'todo');
    if (firstTodo) {
      firstTodo.status = 'doing';
      firstTodo.startedAt = firstTodo.startedAt ?? ts;
      firstTodo.attempts = (firstTodo.attempts ?? 0) + 1;
      firstTodo.updatedAt = ts;
      currentTaskId = firstTodo.id;
      appendTaskEvent(planId, {
        eventType: 'task_started',
        planId,
        taskId: firstTodo.id,
        from: 'todo',
        to: 'doing',
        ts,
        source
      });
    }
  } else {
    currentTaskId = existingDoing.id;
  }

  appendTaskEvent(planId, {
    eventType: 'phase_changed',
    planId,
    from: snapshot.phase,
    to: 'solving',
    ts,
    source
  });

  return saveTaskSnapshot({
    ...snapshot,
    phase: 'solving',
    orchestratorStep: 'tasking',
    currentTaskId,
    lastUpdatedTaskId: currentTaskId,
    items
  });
}

function startNextTodoTask(planId: string, items: TaskItem[], source: string): { items: TaskItem[]; currentTaskId?: string } {
  const nextItems = items.map((item) => ({ ...item }));
  const nextTodo = nextItems.find((item) => item.status === 'todo');
  if (!nextTodo) {
    return {
      items: nextItems,
      currentTaskId: undefined
    };
  }

  const ts = nowIso();
  nextTodo.status = 'doing';
  nextTodo.updatedAt = ts;
  nextTodo.startedAt = nextTodo.startedAt ?? ts;
  nextTodo.attempts = (nextTodo.attempts ?? 0) + 1;
  appendTaskEvent(planId, {
    eventType: 'task_started',
    planId,
    taskId: nextTodo.id,
    from: 'todo',
    to: 'doing',
    ts,
    source
  });

  return {
    items: nextItems,
    currentTaskId: nextTodo.id
  };
}

export function updateCurrentTaskOutcome(
  planId: string,
  outcome: 'done' | 'blocked' | 'doing',
  options?: { note?: string; source?: string }
): TaskStateSnapshot | null {
  const snapshot = loadTaskSnapshot(planId);
  if (!snapshot || snapshot.phase !== 'solving') {
    return snapshot;
  }

  const source = options?.source ?? 'runtime';
  const note = options?.note?.trim() ?? '';
  const ts = nowIso();
  const items = snapshot.items.map((item) => ({ ...item }));
  const current = items.find((item) => item.status === 'doing');
  if (!current) {
    return snapshot;
  }

  if (outcome === 'doing') {
    if (!note) {
      return snapshot;
    }
    current.notes = note;
    current.updatedAt = ts;
    appendTaskEvent(planId, {
      eventType: 'task_note_updated',
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

  if (outcome === 'blocked') {
    current.status = 'blocked';
    current.blockedReason = note || current.blockedReason;
    current.notes = note || current.notes;
    current.updatedAt = ts;
    appendTaskEvent(planId, {
      eventType: 'task_blocked',
      planId,
      taskId: current.id,
      from: 'doing',
      to: 'blocked',
      ts,
      source,
      note
    });
    return saveTaskSnapshot({
      ...snapshot,
      items,
      currentTaskId: undefined,
      lastUpdatedTaskId: current.id
    });
  }

  current.status = 'done';
  current.completedAt = ts;
  current.updatedAt = ts;
  if (note) {
    current.notes = note;
  }
  appendTaskEvent(planId, {
    eventType: 'task_completed',
    planId,
    taskId: current.id,
    from: 'doing',
    to: 'done',
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

export function ensureSolvingTaskConsistency(planId: string, source = 'self_heal'): TaskStateSnapshot | null {
  const snapshot = loadTaskSnapshot(planId);
  if (!snapshot || snapshot.phase !== 'solving') {
    return snapshot;
  }

  const doingCount = snapshot.items.filter((item) => item.status === 'doing').length;
  if (doingCount > 0) {
    return snapshot;
  }
  const hasTodo = snapshot.items.some((item) => item.status === 'todo');
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

export function parseTaskOutcomeFromAssistantReply(
  reply: string
): { outcome: 'done' | 'blocked' | 'doing'; note?: string } | null {
  const normalized = reply.replace(/\r\n/g, '\n');
  const stateMatch = normalized.match(/^TASK_STATE:\s*(done|blocked|doing)\s*$/gim);
  if (!stateMatch || stateMatch.length === 0) {
    return null;
  }
  const lastStateLine = stateMatch[stateMatch.length - 1] ?? '';
  const outcomeMatch = lastStateLine.match(/(done|blocked|doing)/i);
  if (!outcomeMatch) {
    return null;
  }
  const noteMatch = normalized.match(/^TASK_NOTE:\s*(.*)$/gim);
  const note =
    noteMatch && noteMatch.length > 0 ? noteMatch[noteMatch.length - 1]?.replace(/^TASK_NOTE:\s*/i, '').trim() : '';
  return {
    outcome: outcomeMatch[1].toLowerCase() as 'done' | 'blocked' | 'doing',
    note: note || undefined
  };
}

export function formatTaskProgressLine(snapshot: TaskStateSnapshot): string {
  const current = snapshot.items.find((item) => item.id === snapshot.currentTaskId);
  return [
    `plan=${snapshot.planId}`,
    `v=${snapshot.planVersion}`,
    `phase=${snapshot.phase}`,
    `step=${snapshot.orchestratorStep ?? 'tasking'}`,
    `progress=${snapshot.progress.done}/${snapshot.progress.total} (${snapshot.progress.percent}%)`,
    `doing=${current ? current.title : 'none'}`,
    `blocked=${snapshot.blockedCount}`
  ].join(' | ');
}

function sortByStatus(items: TaskItem[]): TaskItem[] {
  const order: Record<TaskStatus, number> = {
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

export function formatTaskSummary(snapshot: TaskStateSnapshot): string {
  const header = [
    `plan_id: ${snapshot.planId}`,
    `plan_version: ${snapshot.planVersion}`,
    `phase: ${snapshot.phase}`,
    `orchestrator_step: ${snapshot.orchestratorStep ?? '(none)'}`,
    `last_replan_reason: ${snapshot.lastReplanReason ?? '(none)'}`,
    `progress: ${snapshot.progress.done}/${snapshot.progress.total} (${snapshot.progress.percent}%)`,
    `stats: total=${snapshot.stats.total} todo=${snapshot.stats.todo} doing=${snapshot.stats.doing} blocked=${snapshot.stats.blocked} done=${snapshot.stats.done}`,
    `current_task: ${snapshot.items.find((item) => item.id === snapshot.currentTaskId)?.title ?? '(none)'}`
  ];
  const rows = sortByStatus(snapshot.items).map(
    (item) =>
      `- [${item.status}] ${item.id} ${item.title}${item.notes ? ` (${item.notes})` : ''}${
        item.blockedReason ? ` [reason: ${item.blockedReason}]` : ''
      }`
  );
  return [...header, '', ...rows].join('\n');
}

export function formatTaskTodos(snapshot: TaskStateSnapshot): string {
  const lines = snapshot.items.map((item) => {
    const checked = item.status === 'done' ? 'x' : item.status === 'doing' ? '-' : ' ';
    const statusTag = item.status === 'done' ? '' : ` (${item.status})`;
    return `- [${checked}] ${item.title}${statusTag}`;
  });
  return lines.join('\n');
}

function normalizeCompareTitle(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function rebasePlanItems(existing: TaskItem[], nextTitles: string[], ts: string): TaskItem[] {
  const exactByTitle = new Map(existing.map((item) => [item.title, item]));
  const normalizedByTitle = new Map(existing.map((item) => [normalizeCompareTitle(item.title), item]));
  const usedIds = new Set<string>();
  const next: TaskItem[] = [];

  for (const [index, title] of nextTitles.entries()) {
    const exact = exactByTitle.get(title);
    const fuzzy = normalizedByTitle.get(normalizeCompareTitle(title));
    const matched = exact ?? fuzzy;
    const id = `task_${index + 1}`;
    if (matched) {
      usedIds.add(matched.id);
      next.push({
        ...matched,
        id,
        title,
        status: matched.status === 'done' ? 'done' : 'todo',
        updatedAt: ts
      });
      continue;
    }

    next.push({
      id,
      title,
      status: 'todo',
      updatedAt: ts
    });
  }

  const carry = existing.filter((item) => !usedIds.has(item.id) && (item.status === 'blocked' || item.status === 'done'));
  for (const item of carry) {
    next.push({
      ...item,
      id: `task_${next.length + 1}`,
      updatedAt: ts
    });
  }

  return next;
}

export function applyReplanArtifacts(args: {
  planId: string;
  planText: string;
  reason: string;
  source?: string;
}): TaskStateSnapshot | null {
  const snapshot = loadTaskSnapshot(args.planId);
  if (!snapshot) {
    return null;
  }
  const source = args.source ?? 'replanner';
  const parsed = parsePlanTodoItems(args.planText);
  if (parsed.error) {
    recordTaskEvent(args.planId, {
      eventType: 'replan_skipped',
      source,
      note: `invalid_new_plan:${parsed.error}:${parsed.detail ?? parsed.error}`
    });
    return snapshot;
  }
  const nextTitles = parsed.items;

  const ts = nowIso();
  const nextItems = rebasePlanItems(snapshot.items, nextTitles, ts);

  recordTaskEvent(args.planId, {
    eventType: 'replan_applied',
    source,
    note: args.reason,
    from: `v${snapshot.planVersion}`,
    to: `v${snapshot.planVersion + 1}`,
    ts
  });

  const saved = saveTaskSnapshot({
    ...snapshot,
    phase: snapshot.phase === 'completed' ? 'planning' : snapshot.phase,
    planVersion: snapshot.planVersion + 1,
    lastReplanReason: args.reason,
    orchestratorStep: 'replanning',
    currentTaskId: undefined,
    lastUpdatedTaskId: snapshot.lastUpdatedTaskId,
    updatedAt: ts,
    items: nextItems
  });

  if (saved.phase === 'solving') {
    return ensureSolvingTaskConsistency(saved.planId, source);
  }
  return saved;
}

