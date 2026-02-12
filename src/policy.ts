import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type HappyCodePolicy = {
  allowShellPrefixes?: string[];
  denyShellPatterns?: string[];
  protectedPaths?: string[];
};

export type ResolvedPolicy = {
  allowShellPrefixes: string[];
  denyShellPatterns: string[];
  protectedPaths: string[];
  policyPath: string;
};

const DEFAULT_ALLOW_PREFIXES = [
  'git status',
  'git diff',
  'git log',
  'git branch',
  'git show',
  'npm test',
  'npm run',
  'pnpm test',
  'pnpm run',
  'yarn test',
  'yarn run',
  'node ',
  'python ',
  'pytest',
  'cargo test',
  'go test',
  'ls',
  'dir',
  'cat',
  'type ',
  'rg ',
  'findstr '
];

const DEFAULT_DENY_PATTERNS = [
  '(^|\\s)rm\\s+-rf\\s+/',
  '(^|\\s)mkfs\\b',
  '(^|\\s)dd\\s+if=',
  '(^|\\s)shutdown\\b',
  '(^|\\s)reboot\\b',
  '(^|\\s)poweroff\\b',
  '(^|\\s)diskpart\\b',
  '(^|\\s)format\\s+[a-z]:',
  '(^|\\s)del\\s+\\/f\\s+\\/s\\s+\\/q\\b',
  '(^|\\s)Remove-Item\\b.+-Recurse.+-Force',
  '(^|\\s)git\\s+reset\\s+--hard\\b'
];

const DEFAULT_PROTECTED_PATHS = ['.git', 'node_modules'];

const GLOBAL_POLICY_DIR = path.join(os.homedir(), '.happycode');
const GLOBAL_POLICY_PATH = path.join(GLOBAL_POLICY_DIR, 'policy.json');

function mergeUnique(values: string[]): string[] {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))];
}

function resolveField(projectValue: string[] | undefined, globalValue: string[] | undefined, fallback: string[]): string[] {
  if (Array.isArray(projectValue)) {
    return mergeUnique(projectValue);
  }
  if (Array.isArray(globalValue)) {
    return mergeUnique(globalValue);
  }
  return [...fallback];
}

export function getPolicyPath(cwd: string): string {
  return path.join(cwd, '.happycode-policy.json');
}

export function getGlobalPolicyPath(): string {
  return GLOBAL_POLICY_PATH;
}

function readPolicyFile(policyPath: string): HappyCodePolicy {
  if (!fs.existsSync(policyPath)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(policyPath, 'utf8');
    return JSON.parse(raw) as HappyCodePolicy;
  } catch {
    return {};
  }
}

export function loadPolicy(cwd: string): ResolvedPolicy {
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

export function writeDefaultPolicy(cwd: string): string {
  const policyPath = getPolicyPath(cwd);
  if (fs.existsSync(policyPath)) {
    return policyPath;
  }
  const sample: HappyCodePolicy = {
    allowShellPrefixes: DEFAULT_ALLOW_PREFIXES,
    denyShellPatterns: DEFAULT_DENY_PATTERNS,
    protectedPaths: DEFAULT_PROTECTED_PATHS
  };
  fs.writeFileSync(policyPath, `${JSON.stringify(sample, null, 2)}\n`, 'utf8');
  return policyPath;
}

export function writeDefaultGlobalPolicy(): string {
  const policyPath = getGlobalPolicyPath();
  if (fs.existsSync(policyPath)) {
    return policyPath;
  }
  fs.mkdirSync(path.dirname(policyPath), { recursive: true });
  const sample: HappyCodePolicy = {
    allowShellPrefixes: DEFAULT_ALLOW_PREFIXES,
    denyShellPatterns: DEFAULT_DENY_PATTERNS,
    protectedPaths: DEFAULT_PROTECTED_PATHS
  };
  fs.writeFileSync(policyPath, `${JSON.stringify(sample, null, 2)}\n`, 'utf8');
  return policyPath;
}

export function isProtectedRelativePath(relPath: string, policy: ResolvedPolicy): boolean {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\.\//, '');
  return policy.protectedPaths.some((item) => {
    const p = item.replace(/\\/g, '/').replace(/^\.\//, '');
    return normalized === p || normalized.startsWith(`${p}/`);
  });
}
