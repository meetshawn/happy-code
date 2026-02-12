// src/modes.ts
function getModePolicy(mode) {
  switch (mode) {
    case "ask":
      return { allowWrite: false, allowExec: false };
    case "plan":
      return { allowWrite: false, allowExec: false };
    case "edit":
      return { allowWrite: true, allowExec: false };
    case "auto":
      return { allowWrite: true, allowExec: true };
    default:
      return { allowWrite: false, allowExec: false };
  }
}
function getModePrompt(mode) {
  switch (mode) {
    case "ask":
      return "Mode=ask. Answer coding questions, inspect files, do not modify files, do not run shell commands.";
    case "plan":
      return "Mode=plan. First produce an explicit implementation plan. You may inspect files, but do not modify files or run shell commands.";
    case "edit":
      return "Mode=edit. You may inspect and edit project files to complete tasks. Do not run shell commands.";
    case "auto":
      return "Mode=auto. You may inspect/edit files and run safe shell commands when required.";
    default:
      return "Mode=ask. Read-only coding assistant behavior.";
  }
}
var SUPPORTED_MODES = ["ask", "plan", "edit", "auto"];

// src/audit.ts
import fs from "fs";
import os from "os";
import path from "path";
var AUDIT_DIR = path.join(os.homedir(), ".happycode");
var AUDIT_PATH = path.join(AUDIT_DIR, "audit.log");
function ensureDir() {
  fs.mkdirSync(AUDIT_DIR, { recursive: true });
}
function getAuditPath() {
  return AUDIT_PATH;
}
function appendAudit(record) {
  ensureDir();
  fs.appendFileSync(AUDIT_PATH, `${JSON.stringify(record)}
`, "utf8");
}
function readRecentAudit(limit = 50) {
  if (!fs.existsSync(AUDIT_PATH)) {
    return [];
  }
  const raw = fs.readFileSync(AUDIT_PATH, "utf8");
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const slice = lines.slice(-Math.max(1, limit));
  const records = [];
  for (const line of slice) {
    try {
      records.push(JSON.parse(line));
    } catch {
      continue;
    }
  }
  return records;
}

// src/approvals.ts
import fs2 from "fs";
import os2 from "os";
import path2 from "path";
var APPROVAL_DIR = path2.join(os2.homedir(), ".happycode");
var APPROVAL_PATH = path2.join(APPROVAL_DIR, "approvals.json");
function ensureDir2() {
  fs2.mkdirSync(APPROVAL_DIR, { recursive: true });
}
function readState() {
  if (!fs2.existsSync(APPROVAL_PATH)) {
    return { approvedCommandPrefixes: [] };
  }
  try {
    const raw = fs2.readFileSync(APPROVAL_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.approvedCommandPrefixes)) {
      return { approvedCommandPrefixes: [] };
    }
    return parsed;
  } catch {
    return { approvedCommandPrefixes: [] };
  }
}
function writeState(state) {
  ensureDir2();
  fs2.writeFileSync(APPROVAL_PATH, `${JSON.stringify(state, null, 2)}
`, "utf8");
}
function getApprovalPath() {
  return APPROVAL_PATH;
}
function allowCommandPrefix(prefix) {
  const state = readState();
  if (!state.approvedCommandPrefixes.includes(prefix)) {
    state.approvedCommandPrefixes.push(prefix);
    writeState(state);
  }
}
function clearCommandApprovals() {
  writeState({ approvedCommandPrefixes: [] });
}
function isApprovedCommand(command) {
  const state = readState();
  const value = command.trim().toLowerCase();
  return state.approvedCommandPrefixes.some((prefix) => value.startsWith(prefix.toLowerCase()));
}
function getApprovalPrefixes() {
  return readState().approvedCommandPrefixes;
}

// src/policy.ts
import fs3 from "fs";
import path3 from "path";
var DEFAULT_ALLOW_PREFIXES = [
  "git status",
  "git diff",
  "git log",
  "git branch",
  "git show",
  "npm test",
  "npm run",
  "pnpm test",
  "pnpm run",
  "yarn test",
  "yarn run",
  "node ",
  "python ",
  "pytest",
  "cargo test",
  "go test",
  "ls",
  "dir",
  "cat",
  "type ",
  "rg ",
  "findstr "
];
var DEFAULT_DENY_PATTERNS = [
  "(^|\\s)rm\\s+-rf\\s+/",
  "(^|\\s)mkfs\\b",
  "(^|\\s)dd\\s+if=",
  "(^|\\s)shutdown\\b",
  "(^|\\s)reboot\\b",
  "(^|\\s)poweroff\\b",
  "(^|\\s)diskpart\\b",
  "(^|\\s)format\\s+[a-z]:",
  "(^|\\s)del\\s+\\/f\\s+\\/s\\s+\\/q\\b",
  "(^|\\s)Remove-Item\\b.+-Recurse.+-Force",
  "(^|\\s)git\\s+reset\\s+--hard\\b"
];
var DEFAULT_PROTECTED_PATHS = [".git", "node_modules"];
function getPolicyPath(cwd) {
  return path3.join(cwd, ".happycode-policy.json");
}
function readPolicyFile(policyPath) {
  if (!fs3.existsSync(policyPath)) {
    return {};
  }
  try {
    const raw = fs3.readFileSync(policyPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
function loadPolicy(cwd) {
  const policyPath = getPolicyPath(cwd);
  const raw = readPolicyFile(policyPath);
  return {
    policyPath,
    allowShellPrefixes: raw.allowShellPrefixes ?? DEFAULT_ALLOW_PREFIXES,
    denyShellPatterns: raw.denyShellPatterns ?? DEFAULT_DENY_PATTERNS,
    protectedPaths: raw.protectedPaths ?? DEFAULT_PROTECTED_PATHS
  };
}
function writeDefaultPolicy(cwd) {
  const policyPath = getPolicyPath(cwd);
  if (fs3.existsSync(policyPath)) {
    return policyPath;
  }
  const sample = {
    allowShellPrefixes: DEFAULT_ALLOW_PREFIXES,
    denyShellPatterns: DEFAULT_DENY_PATTERNS,
    protectedPaths: DEFAULT_PROTECTED_PATHS
  };
  fs3.writeFileSync(policyPath, `${JSON.stringify(sample, null, 2)}
`, "utf8");
  return policyPath;
}
function isProtectedRelativePath(relPath, policy) {
  const normalized = relPath.replace(/\\/g, "/").replace(/^\.\//, "");
  return policy.protectedPaths.some((item) => {
    const p = item.replace(/\\/g, "/").replace(/^\.\//, "");
    return normalized === p || normalized.startsWith(`${p}/`);
  });
}

// src/agent.ts
import OpenAI from "openai";

// src/tools.ts
import fs4 from "fs";
import path4 from "path";
import { exec } from "child_process";
import { promisify } from "util";
import fg from "fast-glob";

// src/security.ts
function validateShellCommand(command, policy) {
  const normalized = command.trim();
  if (!normalized) {
    return { ok: false, reason: "Empty command." };
  }
  for (const rawPattern of policy.denyShellPatterns) {
    try {
      const regex = new RegExp(rawPattern, "i");
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
    return { ok: false, reason: "Command not in policy allowShellPrefixes." };
  }
  return { ok: true };
}

// src/tools.ts
var execAsync = promisify(exec);
var MAX_READ = 3e4;
var MAX_OUTPUT = 2e4;
function resolveInCwd(cwd, inputPath) {
  const resolved = path4.resolve(cwd, inputPath);
  const normalizedCwd = path4.resolve(cwd) + path4.sep;
  if (resolved !== path4.resolve(cwd) && !resolved.startsWith(normalizedCwd)) {
    throw new Error("Path escapes current workspace.");
  }
  return resolved;
}
function toRelative(cwd, fullPath) {
  return path4.relative(cwd, fullPath).replace(/\\/g, "/");
}
function clampOutput(text, limit = MAX_OUTPUT) {
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit)}

...[truncated]`;
}
function stringArg(args, key, fallback = "") {
  const value = args?.[key];
  return typeof value === "string" ? value : fallback;
}
function numberArg(args, key, fallback) {
  const value = args?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
async function runCommand(cwd, command, timeoutMs = 3e4) {
  const { stdout, stderr } = await execAsync(command, {
    cwd,
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 1024 * 1024
  });
  return clampOutput([stdout, stderr].filter(Boolean).join("\n") || "(no output)");
}
async function listFiles(cwd, pattern = "**/*") {
  const entries = await fg(pattern, {
    cwd,
    onlyFiles: true,
    dot: true,
    ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/build/**"]
  });
  return entries.slice(0, 400);
}
function readFile(cwd, filePath) {
  const fullPath = resolveInCwd(cwd, filePath);
  const content = fs4.readFileSync(fullPath, "utf8");
  return clampOutput(content, MAX_READ);
}
function assertWritable(cwd, filePath) {
  const fullPath = resolveInCwd(cwd, filePath);
  const rel = toRelative(cwd, fullPath);
  const policy = loadPolicy(cwd);
  if (isProtectedRelativePath(rel, policy)) {
    throw new Error(`Path is protected by policy: ${rel}`);
  }
}
function writeFile(cwd, filePath, content) {
  assertWritable(cwd, filePath);
  const fullPath = resolveInCwd(cwd, filePath);
  fs4.mkdirSync(path4.dirname(fullPath), { recursive: true });
  fs4.writeFileSync(fullPath, content, "utf8");
  return `Wrote ${filePath}`;
}
function appendFile(cwd, filePath, content) {
  assertWritable(cwd, filePath);
  const fullPath = resolveInCwd(cwd, filePath);
  fs4.mkdirSync(path4.dirname(fullPath), { recursive: true });
  fs4.appendFileSync(fullPath, content, "utf8");
  return `Appended ${filePath}`;
}
function patchFile(cwd, filePath, findText, replaceText) {
  assertWritable(cwd, filePath);
  const fullPath = resolveInCwd(cwd, filePath);
  const source = fs4.readFileSync(fullPath, "utf8");
  if (!source.includes(findText)) {
    return `Pattern not found in ${filePath}`;
  }
  const next = source.replace(findText, replaceText);
  fs4.writeFileSync(fullPath, next, "utf8");
  return `Patched ${filePath}`;
}
function deleteFile(cwd, filePath) {
  assertWritable(cwd, filePath);
  const fullPath = resolveInCwd(cwd, filePath);
  if (!fs4.existsSync(fullPath)) {
    return `File does not exist: ${filePath}`;
  }
  fs4.unlinkSync(fullPath);
  return `Deleted ${filePath}`;
}
function searchInFiles(cwd, pattern, glob = "**/*.{ts,tsx,js,jsx,py,go,rs,java,md,json,yml,yaml}") {
  const files = fg.sync(glob, {
    cwd,
    onlyFiles: true,
    dot: false,
    ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/build/**"]
  });
  const results = [];
  for (const file of files.slice(0, 700)) {
    const content = fs4.readFileSync(path4.join(cwd, file), "utf8");
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
function audit(context, call, ok, summary) {
  if (!context.enableAudit) {
    return;
  }
  appendAudit({
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    mode: context.mode,
    tool: call.name,
    ok,
    input: call.args ?? {},
    summary
  });
}
function needsCommandApproval(command) {
  return !isApprovedCommand(command);
}
async function runTool(call, context) {
  const policy = getModePolicy(context.mode);
  const runtimePolicy = loadPolicy(context.cwd);
  try {
    if (call.name === "get_context") {
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
      audit(context, call, true, "context returned");
      return payload;
    }
    if (!policy.allowWrite && ["write_file", "append_file", "patch_file", "delete_file"].includes(call.name)) {
      const denied = `Denied by mode policy: ${context.mode} is read-only.`;
      audit(context, call, false, denied);
      return denied;
    }
    if (!policy.allowExec && call.name === "run_shell") {
      const denied = `Denied by mode policy: ${context.mode} cannot run shell commands.`;
      audit(context, call, false, denied);
      return denied;
    }
    let output = "";
    switch (call.name) {
      case "list_files": {
        const pattern = stringArg(call.args, "pattern", "**/*");
        output = JSON.stringify(await listFiles(context.cwd, pattern), null, 2);
        break;
      }
      case "read_file":
        output = readFile(context.cwd, stringArg(call.args, "path"));
        break;
      case "write_file":
        output = writeFile(context.cwd, stringArg(call.args, "path"), stringArg(call.args, "content"));
        break;
      case "append_file":
        output = appendFile(context.cwd, stringArg(call.args, "path"), stringArg(call.args, "content"));
        break;
      case "patch_file":
        output = patchFile(
          context.cwd,
          stringArg(call.args, "path"),
          stringArg(call.args, "find"),
          stringArg(call.args, "replace")
        );
        break;
      case "delete_file":
        output = deleteFile(context.cwd, stringArg(call.args, "path"));
        break;
      case "search_in_files":
        output = searchInFiles(
          context.cwd,
          stringArg(call.args, "pattern"),
          stringArg(call.args, "glob", "**/*.{ts,tsx,js,jsx,py,go,rs,java,md,json,yml,yaml}")
        );
        break;
      case "run_shell": {
        const command = stringArg(call.args, "command");
        const check = validateShellCommand(command, runtimePolicy);
        if (!check.ok) {
          output = `Denied by security policy: ${check.reason ?? "unsafe command."}`;
          audit(context, call, false, output);
          return output;
        }
        if (needsCommandApproval(command)) {
          output = `Approval required. Run in TUI: /allow once ${command} or /allow session ${command}`;
          audit(context, call, false, output);
          return output;
        }
        output = await runCommand(context.cwd, command, numberArg(call.args, "timeout_ms", 3e4));
        break;
      }
      case "git_status":
        output = await runCommand(context.cwd, "git status --short --branch");
        break;
      case "git_diff": {
        const target = stringArg(call.args, "path", "").trim();
        const cmd = target ? `git diff -- ${target}` : "git diff";
        output = await runCommand(context.cwd, cmd);
        break;
      }
      case "git_log": {
        const count = Math.max(1, Math.min(50, numberArg(call.args, "count", 10)));
        output = await runCommand(context.cwd, `git log --oneline -n ${count}`);
        break;
      }
      default:
        output = "Unknown tool";
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
var TOOL_SCHEMA = [
  {
    type: "function",
    function: {
      name: "list_files",
      description: "List files in workspace by glob pattern",
      parameters: {
        type: "object",
        properties: { pattern: { type: "string" } }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read file content from workspace",
      parameters: {
        type: "object",
        required: ["path"],
        properties: { path: { type: "string" } }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Create or overwrite a file in workspace",
      parameters: {
        type: "object",
        required: ["path", "content"],
        properties: {
          path: { type: "string" },
          content: { type: "string" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "append_file",
      description: "Append text to a file in workspace",
      parameters: {
        type: "object",
        required: ["path", "content"],
        properties: {
          path: { type: "string" },
          content: { type: "string" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "patch_file",
      description: "Patch file by replacing first matched text",
      parameters: {
        type: "object",
        required: ["path", "find", "replace"],
        properties: {
          path: { type: "string" },
          find: { type: "string" },
          replace: { type: "string" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "delete_file",
      description: "Delete a file in workspace",
      parameters: {
        type: "object",
        required: ["path"],
        properties: {
          path: { type: "string" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "search_in_files",
      description: "Search a plain text pattern across workspace files",
      parameters: {
        type: "object",
        required: ["pattern"],
        properties: {
          pattern: { type: "string" },
          glob: { type: "string" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "run_shell",
      description: "Run a shell command in workspace. Requires policy pass and explicit approval.",
      parameters: {
        type: "object",
        required: ["command"],
        properties: {
          command: { type: "string" },
          timeout_ms: { type: "number" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "git_status",
      description: "Run git status --short --branch",
      parameters: {
        type: "object",
        properties: {}
      }
    }
  },
  {
    type: "function",
    function: {
      name: "git_diff",
      description: "Run git diff (optionally for specific file)",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "git_log",
      description: "Run git log --oneline with count",
      parameters: {
        type: "object",
        properties: {
          count: { type: "number" }
        }
      }
    }
  }
];

// src/agent.ts
var BASE_PROMPT = "You are HappyCode, a practical coding assistant. Prefer using tools for codebase-grounded answers. Keep responses concise, explicit, and actionable.";
function parseToolArgs(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
function toOpenAIMessages(messages, mode, systemPrompt, appendSystemPrompt) {
  const merged = [
    BASE_PROMPT,
    systemPrompt ?? "",
    getModePrompt(mode),
    appendSystemPrompt ?? ""
  ].map((item) => item.trim()).filter(Boolean).join("\n\n");
  return [{ role: "system", content: merged }, ...messages];
}
function withMcpTools(mcpTools) {
  const extra = (mcpTools ?? []).map((item) => ({
    type: "function",
    function: {
      name: item.fullName,
      description: item.description || `MCP tool ${item.server}/${item.name}`,
      parameters: item.inputSchema ?? {
        type: "object",
        properties: {}
      }
    }
  }));
  return [...TOOL_SCHEMA, ...extra];
}
function filterTools(tools, allowedTools, disallowedTools) {
  const allow = new Set((allowedTools ?? []).map((item) => item.trim()).filter(Boolean));
  const deny = new Set((disallowedTools ?? []).map((item) => item.trim()).filter(Boolean));
  return tools.filter((item) => {
    const name = item.function.name;
    if (allow.size > 0 && !allow.has(name)) {
      return false;
    }
    if (deny.has(name)) {
      return false;
    }
    return true;
  });
}
var HappyCodeAgent = class {
  client;
  model;
  constructor(cfg) {
    this.client = new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl });
    this.model = cfg.model;
  }
  async chatStream(messages, options, onDelta, onToolEvent) {
    const maxTurns = options.maxTurns ?? 8;
    const running = toOpenAIMessages(
      messages,
      options.mode,
      options.systemPrompt,
      options.appendSystemPrompt
    );
    const mergedTools = withMcpTools(options.mcpTools);
    const tools = filterTools(mergedTools, options.allowedTools, options.disallowedTools);
    const model = options.model ?? this.model;
    const fallbackModel = options.fallbackModel;
    const createCompletion = async (completionMessages) => {
      try {
        return await this.client.chat.completions.create({
          model,
          messages: completionMessages,
          tools,
          tool_choice: "auto"
        });
      } catch (err) {
        if (!fallbackModel) {
          throw err;
        }
        return await this.client.chat.completions.create({
          model: fallbackModel,
          messages: completionMessages,
          tools,
          tool_choice: "auto"
        });
      }
    };
    for (let turn = 0; turn < maxTurns; turn += 1) {
      const completion = await createCompletion(running);
      const message = completion.choices[0]?.message;
      if (!message) {
        return "No response.";
      }
      if (!message.tool_calls || message.tool_calls.length === 0) {
        const content = message.content ?? "No content.";
        onDelta?.(content);
        return content;
      }
      running.push({
        role: "assistant",
        content: message.content,
        tool_calls: message.tool_calls
      });
      for (const toolCall of message.tool_calls) {
        if (toolCall.type !== "function") {
          continue;
        }
        const toolName = toolCall.function.name;
        const toolArgs = parseToolArgs(toolCall.function.arguments);
        onToolEvent?.({
          source: "model",
          phase: "start",
          name: toolName,
          args: toolArgs
        });
        let result = "";
        if (toolName.startsWith("mcp__")) {
          if (!options.mcpCall) {
            result = "MCP call unavailable in current runtime.";
          } else {
            try {
              result = await options.mcpCall(toolName, toolArgs);
            } catch (err) {
              result = `Tool error: ${err instanceof Error ? err.message : String(err)}`;
            }
          }
        } else {
          result = await runTool(
            {
              name: toolName,
              args: toolArgs
            },
            {
              mode: options.mode,
              cwd: options.cwd,
              enableAudit: options.enableAudit ?? true
            }
          );
        }
        onToolEvent?.({
          source: "model",
          phase: "end",
          name: toolName,
          args: toolArgs,
          ok: !result.startsWith("Denied") && !result.startsWith("Tool error"),
          preview: result.slice(0, 180)
        });
        running.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: result
        });
      }
    }
    return "Stopped after max tool turns. Please refine your request.";
  }
};

// src/config.ts
import fs5 from "fs";
import os3 from "os";
import path5 from "path";
var CONFIG_DIR = path5.join(os3.homedir(), ".happycode");
var CONFIG_PATH = path5.join(CONFIG_DIR, "config.json");
function getConfigPath() {
  return CONFIG_PATH;
}
function ensureConfigDir() {
  fs5.mkdirSync(CONFIG_DIR, { recursive: true });
}
function readConfig() {
  if (!fs5.existsSync(CONFIG_PATH)) {
    return null;
  }
  const raw = fs5.readFileSync(CONFIG_PATH, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed.baseUrl || !parsed.apiKey) {
    return null;
  }
  return {
    baseUrl: parsed.baseUrl,
    apiKey: parsed.apiKey,
    model: parsed.model ?? "gpt-4o-mini"
  };
}
function writeConfig(config) {
  ensureConfigDir();
  fs5.writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}
`, "utf8");
}

export {
  getModePolicy,
  getModePrompt,
  SUPPORTED_MODES,
  getAuditPath,
  readRecentAudit,
  getApprovalPath,
  allowCommandPrefix,
  clearCommandApprovals,
  getApprovalPrefixes,
  getPolicyPath,
  loadPolicy,
  writeDefaultPolicy,
  HappyCodeAgent,
  getConfigPath,
  readConfig,
  writeConfig
};
