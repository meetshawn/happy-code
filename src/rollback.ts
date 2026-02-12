import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import type { ChatMessage } from './agent.js';
import type { InputHistoryEntry } from './session.js';

export type RollbackMode = 'both' | 'dialogue_only' | 'keep';

export type PreTurnSnapshot = {
  historyEntryId: string;
  cwd: string;
  history: ChatMessage[];
  toolEvents: Array<Record<string, unknown>>;
  inputBeforeTurn: string;
  inputHistoryBeforeTurn: InputHistoryEntry[];
  suggestionIndexBeforeTurn: number;
  trackedFiles: string[];
  fileContentsBefore: Record<string, string | null>;
  hadGit: boolean;
};

function listFilesSafe(cwd: string): string[] {
  try {
    const output = execSync('git ls-files', {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore']
    })
      .toString('utf8')
      .trim();
    if (!output) {
      return [];
    }
    return output.split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}

function fileExists(cwd: string, relPath: string): boolean {
  return fs.existsSync(path.join(cwd, relPath));
}

function readFileOptional(cwd: string, relPath: string): string | null {
  const full = path.join(cwd, relPath);
  if (!fs.existsSync(full)) {
    return null;
  }
  try {
    return fs.readFileSync(full, 'utf8');
  } catch {
    return null;
  }
}

export function capturePreTurnSnapshot(args: {
  historyEntryId: string;
  cwd: string;
  history: ChatMessage[];
  toolEvents: Array<Record<string, unknown>>;
  inputBeforeTurn: string;
  inputHistoryBeforeTurn: InputHistoryEntry[];
  suggestionIndexBeforeTurn: number;
}): PreTurnSnapshot {
  const gitFiles = listFilesSafe(args.cwd);
  const hadGit = gitFiles.length > 0;
  const trackedFiles = hadGit ? gitFiles : [];
  const fileContentsBefore: Record<string, string | null> = {};
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

export function rollbackCode(snapshot: PreTurnSnapshot): { ok: boolean; message: string } {
  if (!snapshot.hadGit) {
    return {
      ok: false,
      message: 'No git repository detected for code rollback.'
    };
  }

  const touched = new Set<string>();
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
      message: 'No code changes detected since turn start.'
    };
  }

  for (const rel of touched) {
    const before = snapshot.fileContentsBefore[rel] ?? null;
    const full = path.join(snapshot.cwd, rel);
    if (before === null) {
      if (fileExists(snapshot.cwd, rel)) {
        try {
          fs.unlinkSync(full);
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
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, before, 'utf8');
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
