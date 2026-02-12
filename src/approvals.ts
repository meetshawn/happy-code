import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type ApprovalState = {
  globalApprovedCommandPrefixes: string[];
};

const APPROVAL_DIR = path.join(os.homedir(), '.happycode');
const APPROVAL_PATH = path.join(APPROVAL_DIR, 'approvals.json');

function ensureDir(): void {
  fs.mkdirSync(APPROVAL_DIR, { recursive: true });
}

function readState(): ApprovalState {
  if (!fs.existsSync(APPROVAL_PATH)) {
    return { globalApprovedCommandPrefixes: [] };
  }
  try {
    const raw = fs.readFileSync(APPROVAL_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<ApprovalState> & { approvedCommandPrefixes?: string[] };
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

function writeState(state: ApprovalState): void {
  ensureDir();
  fs.writeFileSync(APPROVAL_PATH, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export function getApprovalPath(): string {
  return APPROVAL_PATH;
}

export function allowGlobalCommandPrefix(prefix: string): void {
  const state = readState();
  if (!state.globalApprovedCommandPrefixes.includes(prefix)) {
    state.globalApprovedCommandPrefixes.push(prefix);
    writeState(state);
  }
}

export function clearGlobalCommandApprovals(): void {
  writeState({ globalApprovedCommandPrefixes: [] });
}

export function isGloballyApprovedCommand(command: string): boolean {
  const state = readState();
  const value = command.trim().toLowerCase();
  return state.globalApprovedCommandPrefixes.some((prefix) => value.startsWith(prefix.toLowerCase()));
}

export function getGlobalApprovalPrefixes(): string[] {
  return readState().globalApprovedCommandPrefixes;
}

export const allowCommandPrefix = allowGlobalCommandPrefix;
export const clearCommandApprovals = clearGlobalCommandApprovals;
export const isApprovedCommand = isGloballyApprovedCommand;
export const getApprovalPrefixes = getGlobalApprovalPrefixes;
