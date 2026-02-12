import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exec } from 'node:child_process';

export type MemoryScope = 'user' | 'project';
export type MemorySection = 'facts' | 'preferences' | 'constraints' | 'notes';

export type MemoryDocument = {
  scope: MemoryScope;
  updatedAt: string;
  facts: string[];
  preferences: string[];
  constraints: string[];
  notes: string[];
};

const GLOBAL_MEMORY_PATH = path.join(os.homedir(), '.happycode', 'memory_user.md');
const LEGACY_MEMORY_PATH = path.join(os.homedir(), '.happycode', 'memory.md');
const PROJECT_MEMORY_DIR = '.happycode';
const PROJECT_MEMORY_FILE = 'memory_project.md';
const LEGACY_PROJECT_MEMORY_FILE = '.happycode-memory.md';
const MEMORY_PROMPT_MAX_CHARS = 2400;

const SECTION_LABELS: Record<MemorySection, string> = {
  facts: 'Facts',
  preferences: 'Preferences',
  constraints: 'Constraints',
  notes: 'Notes'
};

const SECTION_PRIORITY: MemorySection[] = ['constraints', 'preferences', 'facts', 'notes'];

function normalizeLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function emptyDocument(scope: MemoryScope): MemoryDocument {
  return {
    scope,
    updatedAt: new Date().toISOString(),
    facts: [],
    preferences: [],
    constraints: [],
    notes: []
  };
}

function parseSectionLabel(raw: string): MemorySection | null {
  const normalized = normalizeLine(raw).toLowerCase();
  if (normalized === 'facts') {
    return 'facts';
  }
  if (normalized === 'preferences') {
    return 'preferences';
  }
  if (normalized === 'constraints') {
    return 'constraints';
  }
  if (normalized === 'notes') {
    return 'notes';
  }
  return null;
}

function parseMemoryMarkdown(content: string, scope: MemoryScope): MemoryDocument {
  const doc = emptyDocument(scope);
  let activeSection: MemorySection | null = null;

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed.startsWith('# ')) {
      continue;
    }
    if (trimmed.startsWith('## ')) {
      activeSection = parseSectionLabel(trimmed.slice(3));
      continue;
    }
    if (trimmed.startsWith('- updatedAt:')) {
      const raw = normalizeLine(trimmed.slice('- updatedAt:'.length));
      if (raw) {
        doc.updatedAt = raw;
      }
      continue;
    }
    if (!activeSection) {
      continue;
    }
    const value = trimmed.startsWith('- ') ? normalizeLine(trimmed.slice(2)) : normalizeLine(trimmed);
    if (!value) {
      continue;
    }
    doc[activeSection].push(value);
  }

  return doc;
}

function toMemoryMarkdown(doc: MemoryDocument): string {
  const lines: string[] = [
    '# HappyCode Memory',
    '## Meta',
    `- scope: ${doc.scope}`,
    `- updatedAt: ${doc.updatedAt}`
  ];

  for (const section of SECTION_PRIORITY) {
    lines.push(`## ${SECTION_LABELS[section]}`);
    const entries = doc[section];
    if (entries.length === 0) {
      lines.push('- (empty)');
      continue;
    }
    for (const item of entries) {
      lines.push(`- ${item}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

function defaultMemoryMarkdown(scope: MemoryScope): string {
  return toMemoryMarkdown(emptyDocument(scope));
}

function ensureParentDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function scopePath(scope: MemoryScope, cwd = process.cwd()): string {
  if (scope === 'user') {
    return GLOBAL_MEMORY_PATH;
  }
  return path.join(cwd, PROJECT_MEMORY_DIR, PROJECT_MEMORY_FILE);
}

function legacyProjectScopePath(cwd = process.cwd()): string {
  return path.join(cwd, LEGACY_PROJECT_MEMORY_FILE);
}

function migrateLegacyProjectMemoryIfNeeded(cwd = process.cwd()): void {
  const currentPath = scopePath('project', cwd);
  const legacyPath = legacyProjectScopePath(cwd);

  if (fs.existsSync(currentPath) || !fs.existsSync(legacyPath)) {
    return;
  }

  const legacyRaw = fs.readFileSync(legacyPath, 'utf8');
  const migratedDoc = parseMemoryMarkdown(legacyRaw, 'project');
  writeMemoryDocument('project', migratedDoc, cwd);
}

function enforceUniqueSection(items: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
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

function truncateBlock(lines: string[], limit: number): string {
  const buffer: string[] = [];
  for (const line of lines) {
    const next = buffer.length === 0 ? line : `${buffer.join('\n')}\n${line}`;
    if (next.length > limit) {
      if (buffer.length === 0) {
        return `${line.slice(0, Math.max(0, limit - 3))}...`;
      }
      return `${buffer.join('\n')}\n...`;
    }
    buffer.push(line);
  }
  return buffer.join('\n');
}

function buildScopePrompt(title: string, doc: MemoryDocument, limit: number): string {
  const lines: string[] = [title];
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
    lines.push('- (empty)');
  }
  return truncateBlock(lines, limit);
}

export function getMemoryPath(): string {
  return GLOBAL_MEMORY_PATH;
}

export function getLegacyMemoryPath(): string {
  return LEGACY_MEMORY_PATH;
}

export function getProjectMemoryPath(cwd = process.cwd()): string {
  return scopePath('project', cwd);
}

export function readMemory(scope: MemoryScope = 'user', cwd = process.cwd()): string {
  if (scope === 'project') {
    migrateLegacyProjectMemoryIfNeeded(cwd);
  }
  const target = scopePath(scope, cwd);
  if (!fs.existsSync(target)) {
    return '';
  }
  return fs.readFileSync(target, 'utf8');
}

export function readMemoryDocument(scope: MemoryScope = 'user', cwd = process.cwd()): MemoryDocument {
  if (scope === 'project') {
    migrateLegacyProjectMemoryIfNeeded(cwd);
  }
  const target = scopePath(scope, cwd);
  if (!fs.existsSync(target)) {
    if (scope === 'user' && fs.existsSync(LEGACY_MEMORY_PATH)) {
      const legacy = fs.readFileSync(LEGACY_MEMORY_PATH, 'utf8');
      const migrated = parseMemoryMarkdown(legacy, scope);
      writeMemoryDocument(scope, migrated, cwd);
      return migrated;
    }
    return emptyDocument(scope);
  }
  const raw = fs.readFileSync(target, 'utf8');
  return parseMemoryMarkdown(raw, scope);
}

export function writeMemoryDocument(scope: MemoryScope, doc: MemoryDocument, cwd = process.cwd()): void {
  const target = scopePath(scope, cwd);
  ensureParentDir(target);
  const normalized: MemoryDocument = {
    ...doc,
    scope,
    updatedAt: new Date().toISOString(),
    facts: enforceUniqueSection(doc.facts),
    preferences: enforceUniqueSection(doc.preferences),
    constraints: enforceUniqueSection(doc.constraints),
    notes: enforceUniqueSection(doc.notes)
  };
  fs.writeFileSync(target, toMemoryMarkdown(normalized), 'utf8');
}

export function addMemoryItem(
  scope: MemoryScope,
  section: MemorySection,
  text: string,
  cwd = process.cwd()
): void {
  const value = normalizeLine(text);
  if (!value) {
    return;
  }
  const doc = readMemoryDocument(scope, cwd);
  doc[section] = [...doc[section], value];
  writeMemoryDocument(scope, doc, cwd);
}

export function setMemorySection(
  scope: MemoryScope,
  section: MemorySection,
  values: string[],
  cwd = process.cwd()
): void {
  const doc = readMemoryDocument(scope, cwd);
  doc[section] = values.map((item) => normalizeLine(item)).filter(Boolean);
  writeMemoryDocument(scope, doc, cwd);
}

export function clearMemory(scope: MemoryScope = 'user', cwd = process.cwd()): void {
  const target = scopePath(scope, cwd);
  if (fs.existsSync(target)) {
    fs.unlinkSync(target);
  }
  if (scope === 'project') {
    const legacyTarget = legacyProjectScopePath(cwd);
    if (fs.existsSync(legacyTarget)) {
      fs.unlinkSync(legacyTarget);
    }
  }
}

export function ensureMemoryFile(scope: MemoryScope, cwd = process.cwd()): string {
  if (scope === 'project') {
    migrateLegacyProjectMemoryIfNeeded(cwd);
  }
  const target = scopePath(scope, cwd);
  if (!fs.existsSync(target)) {
    ensureParentDir(target);
    fs.writeFileSync(target, defaultMemoryMarkdown(scope), 'utf8');
  }
  return target;
}

export async function openMemoryFile(
  scope: MemoryScope,
  cwd = process.cwd()
): Promise<{ ok: boolean; path: string; message: string }> {
  const target = ensureMemoryFile(scope, cwd);

  const escaped = target.replace(/"/g, '\\"');
  const command =
    process.platform === 'win32'
      ? `start "" "${escaped}"`
      : process.platform === 'darwin'
        ? `open "${escaped}"`
        : `xdg-open "${escaped}"`;

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

export function appendMemory(note: string, scope: MemoryScope = 'user', cwd = process.cwd()): void {
  addMemoryItem(scope, 'notes', note, cwd);
}

export function formatMemorySummary(scope: MemoryScope, cwd = process.cwd()): string {
  const pathValue = scopePath(scope, cwd);
  const doc = readMemoryDocument(scope, cwd);
  const total = doc.facts.length + doc.preferences.length + doc.constraints.length + doc.notes.length;
  if (total === 0) {
    return `Memory scope: ${scope}\nPath: ${pathValue}\n(empty)`;
  }

  const lines = [
    `Memory scope: ${scope}`,
    `Path: ${pathValue}`,
    `Updated: ${doc.updatedAt}`,
    `Facts (${doc.facts.length})`,
    ...doc.facts.map((item) => `- ${item}`),
    `Preferences (${doc.preferences.length})`,
    ...doc.preferences.map((item) => `- ${item}`),
    `Constraints (${doc.constraints.length})`,
    ...doc.constraints.map((item) => `- ${item}`),
    `Notes (${doc.notes.length})`,
    ...doc.notes.map((item) => `- ${item}`)
  ];
  return lines.join('\n');
}

export function buildRuntimeMemoryPrompt(cwd = process.cwd(), maxChars = MEMORY_PROMPT_MAX_CHARS): string {
  const userDoc = readMemoryDocument('user', cwd);
  const projectDoc = readMemoryDocument('project', cwd);
  const perScope = Math.max(200, Math.floor(maxChars / 2));

  const userBlock = buildScopePrompt('User Memory:', userDoc, perScope);
  const projectBlock = buildScopePrompt('Project Memory:', projectDoc, perScope);

  const merged = [
    '[Persistent Memory]',
    userBlock,
    '',
    projectBlock,
    '',
    'Use memory as soft constraints. If explicit user request conflicts in this turn, follow current request.'
  ]
    .join('\n')
    .trim();

  if (merged === '[Persistent Memory]') {
    return '';
  }

  if (merged.length <= maxChars) {
    return merged;
  }
  return `${merged.slice(0, Math.max(0, maxChars - 3))}...`;
}
