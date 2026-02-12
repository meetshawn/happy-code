import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import fg from 'fast-glob';
import type { AgentMode } from './modes.js';
import { getModePolicy } from './modes.js';
import { appendAudit } from './audit.js';
import { isApprovedCommand } from './approvals.js';
import { isProtectedRelativePath, loadPolicy } from './policy.js';
import { validateShellCommand } from './security.js';

const execAsync = promisify(exec);
const MAX_READ = 30_000;
const MAX_OUTPUT = 20_000;

type JsonObject = Record<string, unknown>;

export type ToolRuntimeContext = {
  mode: AgentMode;
  cwd: string;
  enableAudit?: boolean;
};

export type ToolCall =
  | { name: 'get_context'; args?: JsonObject }
  | { name: 'list_files'; args?: JsonObject }
  | { name: 'read_file'; args?: JsonObject }
  | { name: 'write_file'; args?: JsonObject }
  | { name: 'append_file'; args?: JsonObject }
  | { name: 'patch_file'; args?: JsonObject }
  | { name: 'delete_file'; args?: JsonObject }
  | { name: 'search_in_files'; args?: JsonObject }
  | { name: 'run_shell'; args?: JsonObject }
  | { name: 'git_status'; args?: JsonObject }
  | { name: 'git_diff'; args?: JsonObject }
  | { name: 'git_log'; args?: JsonObject };

function resolveInCwd(cwd: string, inputPath: string): string {
  const resolved = path.resolve(cwd, inputPath);
  const normalizedCwd = path.resolve(cwd) + path.sep;
  if (resolved !== path.resolve(cwd) && !resolved.startsWith(normalizedCwd)) {
    throw new Error('Path escapes current workspace.');
  }
  return resolved;
}

function toRelative(cwd: string, fullPath: string): string {
  return path.relative(cwd, fullPath).replace(/\\/g, '/');
}

function clampOutput(text: string, limit = MAX_OUTPUT): string {
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit)}\n\n...[truncated]`;
}

function stringArg(args: JsonObject | undefined, key: string, fallback = ''): string {
  const value = args?.[key];
  return typeof value === 'string' ? value : fallback;
}

function numberArg(args: JsonObject | undefined, key: string, fallback: number): number {
  const value = args?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

async function runCommand(cwd: string, command: string, timeoutMs = 30_000): Promise<string> {
  const { stdout, stderr } = await execAsync(command, {
    cwd,
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 1024 * 1024
  });
  return clampOutput([stdout, stderr].filter(Boolean).join('\n') || '(no output)');
}

async function listFiles(cwd: string, pattern = '**/*'): Promise<string[]> {
  const entries = await fg(pattern, {
    cwd,
    onlyFiles: true,
    dot: true,
    ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**']
  });
  return entries.slice(0, 400);
}

function readFile(cwd: string, filePath: string): string {
  const fullPath = resolveInCwd(cwd, filePath);
  const content = fs.readFileSync(fullPath, 'utf8');
  return clampOutput(content, MAX_READ);
}

function assertWritable(cwd: string, filePath: string): void {
  const fullPath = resolveInCwd(cwd, filePath);
  const rel = toRelative(cwd, fullPath);
  const policy = loadPolicy(cwd);
  if (isProtectedRelativePath(rel, policy)) {
    throw new Error(`Path is protected by policy: ${rel}`);
  }
}

function writeFile(cwd: string, filePath: string, content: string): string {
  assertWritable(cwd, filePath);
  const fullPath = resolveInCwd(cwd, filePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf8');
  return `Wrote ${filePath}`;
}

function appendFile(cwd: string, filePath: string, content: string): string {
  assertWritable(cwd, filePath);
  const fullPath = resolveInCwd(cwd, filePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.appendFileSync(fullPath, content, 'utf8');
  return `Appended ${filePath}`;
}

function patchFile(cwd: string, filePath: string, findText: string, replaceText: string): string {
  assertWritable(cwd, filePath);
  const fullPath = resolveInCwd(cwd, filePath);
  const source = fs.readFileSync(fullPath, 'utf8');
  if (!source.includes(findText)) {
    return `Pattern not found in ${filePath}`;
  }
  const next = source.replace(findText, replaceText);
  fs.writeFileSync(fullPath, next, 'utf8');
  return `Patched ${filePath}`;
}

function deleteFile(cwd: string, filePath: string): string {
  assertWritable(cwd, filePath);
  const fullPath = resolveInCwd(cwd, filePath);
  if (!fs.existsSync(fullPath)) {
    return `File does not exist: ${filePath}`;
  }
  fs.unlinkSync(fullPath);
  return `Deleted ${filePath}`;
}

function searchInFiles(
  cwd: string,
  pattern: string,
  glob = '**/*.{ts,tsx,js,jsx,py,go,rs,java,md,json,yml,yaml}'
): string {
  const files = fg.sync(glob, {
    cwd,
    onlyFiles: true,
    dot: false,
    ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**']
  });
  const results: Array<{ file: string; line: number; text: string }> = [];
  for (const file of files.slice(0, 700)) {
    const content = fs.readFileSync(path.join(cwd, file), 'utf8');
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

function audit(context: ToolRuntimeContext, call: ToolCall, ok: boolean, summary: string): void {
  if (!context.enableAudit) {
    return;
  }
  appendAudit({
    timestamp: new Date().toISOString(),
    mode: context.mode,
    tool: call.name,
    ok,
    input: call.args ?? {},
    summary
  });
}

function needsCommandApproval(command: string): boolean {
  return !isApprovedCommand(command);
}

export async function runTool(call: ToolCall, context: ToolRuntimeContext): Promise<string> {
  const policy = getModePolicy(context.mode);
  const runtimePolicy = loadPolicy(context.cwd);

  try {
    if (call.name === 'get_context') {
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
      audit(context, call, true, 'context returned');
      return payload;
    }

    if (!policy.allowWrite && ['write_file', 'append_file', 'patch_file', 'delete_file'].includes(call.name)) {
      const denied = `Denied by mode policy: ${context.mode} is read-only.`;
      audit(context, call, false, denied);
      return denied;
    }

    if (!policy.allowExec && call.name === 'run_shell') {
      const denied = `Denied by mode policy: ${context.mode} cannot run shell commands.`;
      audit(context, call, false, denied);
      return denied;
    }

    let output = '';
    switch (call.name) {
      case 'list_files': {
        const pattern = stringArg(call.args, 'pattern', '**/*');
        output = JSON.stringify(await listFiles(context.cwd, pattern), null, 2);
        break;
      }
      case 'read_file':
        output = readFile(context.cwd, stringArg(call.args, 'path'));
        break;
      case 'write_file':
        output = writeFile(context.cwd, stringArg(call.args, 'path'), stringArg(call.args, 'content'));
        break;
      case 'append_file':
        output = appendFile(context.cwd, stringArg(call.args, 'path'), stringArg(call.args, 'content'));
        break;
      case 'patch_file':
        output = patchFile(
          context.cwd,
          stringArg(call.args, 'path'),
          stringArg(call.args, 'find'),
          stringArg(call.args, 'replace')
        );
        break;
      case 'delete_file':
        output = deleteFile(context.cwd, stringArg(call.args, 'path'));
        break;
      case 'search_in_files':
        output = searchInFiles(
          context.cwd,
          stringArg(call.args, 'pattern'),
          stringArg(call.args, 'glob', '**/*.{ts,tsx,js,jsx,py,go,rs,java,md,json,yml,yaml}')
        );
        break;
      case 'run_shell': {
        const command = stringArg(call.args, 'command');
        const check = validateShellCommand(command, runtimePolicy);
        if (!check.ok) {
          output = `Denied by security policy: ${check.reason ?? 'unsafe command.'}`;
          audit(context, call, false, output);
          return output;
        }
        if (needsCommandApproval(command)) {
          output = `Approval required. Run in TUI: /allow once ${command} or /allow session ${command}`;
          audit(context, call, false, output);
          return output;
        }
        output = await runCommand(context.cwd, command, numberArg(call.args, 'timeout_ms', 30_000));
        break;
      }
      case 'git_status':
        output = await runCommand(context.cwd, 'git status --short --branch');
        break;
      case 'git_diff': {
        const target = stringArg(call.args, 'path', '').trim();
        const cmd = target ? `git diff -- ${target}` : 'git diff';
        output = await runCommand(context.cwd, cmd);
        break;
      }
      case 'git_log': {
        const count = Math.max(1, Math.min(50, numberArg(call.args, 'count', 10)));
        output = await runCommand(context.cwd, `git log --oneline -n ${count}`);
        break;
      }
      default:
        output = 'Unknown tool';
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

export const TOOL_SCHEMA = [
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List files in workspace by glob pattern',
      parameters: {
        type: 'object',
        properties: { pattern: { type: 'string' } }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read file content from workspace',
      parameters: {
        type: 'object',
        required: ['path'],
        properties: { path: { type: 'string' } }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Create or overwrite a file in workspace',
      parameters: {
        type: 'object',
        required: ['path', 'content'],
        properties: {
          path: { type: 'string' },
          content: { type: 'string' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'append_file',
      description: 'Append text to a file in workspace',
      parameters: {
        type: 'object',
        required: ['path', 'content'],
        properties: {
          path: { type: 'string' },
          content: { type: 'string' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'patch_file',
      description: 'Patch file by replacing first matched text',
      parameters: {
        type: 'object',
        required: ['path', 'find', 'replace'],
        properties: {
          path: { type: 'string' },
          find: { type: 'string' },
          replace: { type: 'string' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_file',
      description: 'Delete a file in workspace',
      parameters: {
        type: 'object',
        required: ['path'],
        properties: {
          path: { type: 'string' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_in_files',
      description: 'Search a plain text pattern across workspace files',
      parameters: {
        type: 'object',
        required: ['pattern'],
        properties: {
          pattern: { type: 'string' },
          glob: { type: 'string' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_shell',
      description: 'Run a shell command in workspace. Requires policy pass and explicit approval.',
      parameters: {
        type: 'object',
        required: ['command'],
        properties: {
          command: { type: 'string' },
          timeout_ms: { type: 'number' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_status',
      description: 'Run git status --short --branch',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_diff',
      description: 'Run git diff (optionally for specific file)',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_log',
      description: 'Run git log --oneline with count',
      parameters: {
        type: 'object',
        properties: {
          count: { type: 'number' }
        }
      }
    }
  }
] as const;
