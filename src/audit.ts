import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type AuditRecord = {
  timestamp: string;
  tool: string;
  mode: string;
  ok: boolean;
  input: Record<string, unknown>;
  summary: string;
};

const AUDIT_DIR = path.join(os.homedir(), '.happycode');
const AUDIT_PATH = path.join(AUDIT_DIR, 'audit.log');

function ensureDir(): void {
  fs.mkdirSync(AUDIT_DIR, { recursive: true });
}

export function getAuditPath(): string {
  return AUDIT_PATH;
}

export function appendAudit(record: AuditRecord): void {
  ensureDir();
  fs.appendFileSync(AUDIT_PATH, `${JSON.stringify(record)}\n`, 'utf8');
}

export function readRecentAudit(limit = 50): AuditRecord[] {
  if (!fs.existsSync(AUDIT_PATH)) {
    return [];
  }
  const raw = fs.readFileSync(AUDIT_PATH, 'utf8');
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const slice = lines.slice(-Math.max(1, limit));
  const records: AuditRecord[] = [];
  for (const line of slice) {
    try {
      records.push(JSON.parse(line) as AuditRecord);
    } catch {
      continue;
    }
  }
  return records;
}

