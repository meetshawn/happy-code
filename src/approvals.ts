import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type ApprovalState = {
  approvedCommandPrefixes: string[];
};

const APPROVAL_DIR = path.join(os.homedir(), '.happycode');
const APPROVAL_PATH = path.join(APPROVAL_DIR, 'approvals.json');

function ensureDir(): void {
  fs.mkdirSync(APPROVAL_DIR, { recursive: true });
}

function readState(): ApprovalState {
  if (!fs.existsSync(APPROVAL_PATH)) {
    return { approvedCommandPrefixes: [] };
  }
  try {
    const raw = fs.readFileSync(APPROVAL_PATH, 'utf8');
    const parsed = JSON.parse(raw) as ApprovalState;
    if (!Array.isArray(parsed.approvedCommandPrefixes)) {
      return { approvedCommandPrefixes: [] };
    }
    return parsed;
  } catch {
    return { approvedCommandPrefixes: [] };
  }
}

function writeState(state: ApprovalState): void {
  ensureDir();
  fs.writeFileSync(APPROVAL_PATH, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export function getApprovalPath(): string {
  return APPROVAL_PATH;
}

export function allowCommandPrefix(prefix: string): void {
  const state = readState();
  if (!state.approvedCommandPrefixes.includes(prefix)) {
    state.approvedCommandPrefixes.push(prefix);
    writeState(state);
  }
}

export function clearCommandApprovals(): void {
  writeState({ approvedCommandPrefixes: [] });
}

export function isApprovedCommand(command: string): boolean {
  const state = readState();
  const value = command.trim().toLowerCase();
  return state.approvedCommandPrefixes.some((prefix) => value.startsWith(prefix.toLowerCase()));
}

export function getApprovalPrefixes(): string[] {
  return readState().approvedCommandPrefixes;
}

