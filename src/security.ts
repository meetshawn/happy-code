import type { ResolvedPolicy } from './policy.js';

export function validateShellCommand(
  command: string,
  policy: ResolvedPolicy
): { ok: boolean; reason?: string } {
  const normalized = command.trim();
  if (!normalized) {
    return { ok: false, reason: 'Empty command.' };
  }

  for (const rawPattern of policy.denyShellPatterns) {
    try {
      const regex = new RegExp(rawPattern, 'i');
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
    return { ok: false, reason: 'Command not in policy allowShellPrefixes.' };
  }

  return { ok: true };
}

