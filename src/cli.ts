#!/usr/bin/env node
import React from 'react';
import { Command } from 'commander';
import { render } from 'ink';
import { HappyCodeAgent } from './agent.js';
import { MultiAgentRuntime } from './agents_runtime.js';
import { clearCommandApprovals, getApprovalPath, getApprovalPrefixes } from './approvals.js';
import { getAuditPath, readRecentAudit } from './audit.js';
import { getConfigPath, readConfig, writeConfig } from './config.js';
import { SUPPORTED_MODES, type AgentMode } from './modes.js';
import { loadMcpConfig } from './mcp.js';
import { McpClientManager } from './mcp_client.js';
import { getPolicyPath, writeDefaultPolicy } from './policy.js';
import {
  clearSession,
  createSession,
  forkActiveSession,
  getLegacySessionPath,
  getSessionRootPath,
  listSessions,
  loadActiveSession,
  loadSessionMessages,
  renameActiveSession,
  rewindActiveSession,
  saveSessionMessages,
  switchSession
} from './session.js';
import { App } from './ui.js';

const program = new Command();

program
  .name('happycode')
  .description('Coding-focused TUI for OpenAI-compatible APIs')
  .version('0.1.0');

program
  .command('init')
  .description('Save base URL and API key')
  .requiredOption('--base-url <url>', 'OpenAI-compatible base URL, e.g. https://api.openai.com/v1')
  .requiredOption('--api-key <key>', 'API key')
  .option('--model <model>', 'Model name', 'gpt-4o-mini')
  .action((options) => {
    writeConfig({
      baseUrl: options.baseUrl,
      apiKey: options.apiKey,
      model: options.model
    });
    process.stdout.write(`Saved config to ${getConfigPath()}\n`);
  });

program
  .command('run')
  .description('Start TUI')
  .option('--mode <mode>', `Default mode: ${SUPPORTED_MODES.join('|')}`, 'auto')
  .option('--model <name>', 'Override model')
  .option('--fallback-model <name>', 'Fallback model on failure')
  .option('--max-turns <n>', 'Max tool turns', '8')
  .option('--allowed-tools <csv>', 'Comma separated allowed tools')
  .option('--disallowed-tools <csv>', 'Comma separated disallowed tools')
  .option('--system-prompt <text>', 'Override system prompt')
  .option('--append-system-prompt <text>', 'Append additional system prompt text')
  .option('--resume <sessionId>', 'Resume by session id')
  .option('--new [name]', 'Start a fresh session')
  .option('--no-audit', 'Disable tool audit log')
  .action((options) => {
    const cfg = readConfig();
    if (!cfg) {
      process.stderr.write(
        'Config not found. Run:\n  happycode init --base-url <url> --api-key <key> [--model <model>]\n'
      );
      process.exit(1);
    }

    const mode = (options.mode ?? 'auto') as AgentMode;
    if (!SUPPORTED_MODES.includes(mode)) {
      process.stderr.write(`Invalid mode: ${mode}. Allowed: ${SUPPORTED_MODES.join(', ')}\n`);
      process.exit(1);
    }

    if (options.resume) {
      const restored = switchSession(String(options.resume), process.cwd());
      if (!restored) {
        process.stderr.write(`Session not found: ${options.resume}\n`);
        process.exit(1);
      }
    } else {
      const nextName = typeof options.new === 'string' ? options.new : 'new';
      createSession(nextName, process.cwd());
    }

    const agent = new HappyCodeAgent(cfg);
    const mcpManager = new McpClientManager();
    const mcpConfig = loadMcpConfig(process.cwd());
    void mcpManager.ensureServers(mcpConfig);
    const active = loadActiveSession(process.cwd());
    const maxTurns = Number.parseInt(String(options.maxTurns), 10);
    const allowedTools = String(options.allowedTools ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    const disallowedTools = String(options.disallowedTools ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    render(
      React.createElement(App, {
        agent,
        appVersion: program.version(),
        defaultMode: mode,
        defaultModel: options.model,
        defaultRuntime: {
          mode,
          model: options.model,
          fallbackModel: options.fallbackModel,
          maxTurns: Number.isFinite(maxTurns) ? maxTurns : 8,
          allowedTools,
          disallowedTools,
          systemPrompt: options.systemPrompt,
          appendSystemPrompt: options.appendSystemPrompt
        },
        mcpManager,
        enableAudit: options.audit !== false,
        initialHistory: active.messages,
        onHistoryChange: (messages) => saveSessionMessages(messages, process.cwd())
      })
    );
  });

program
  .command('chat')
  .description('Single-turn non-interactive chat')
  .requiredOption('-m, --message <text>', 'User message')
  .option('--mode <mode>', `Mode: ${SUPPORTED_MODES.join('|')}`, 'plan')
  .option('--model <name>', 'Override model')
  .option('--fallback-model <name>', 'Fallback model on failure')
  .option('--max-turns <n>', 'Max tool turns', '8')
  .option('--allowed-tools <csv>', 'Comma separated allowed tools')
  .option('--disallowed-tools <csv>', 'Comma separated disallowed tools')
  .option('--system-prompt <text>', 'Override system prompt')
  .option('--append-system-prompt <text>', 'Append additional system prompt text')
  .option('--json', 'Print JSON output')
  .option('--stream-json', 'Stream JSON chunks')
  .option('--no-audit', 'Disable tool audit log')
  .action(async (options) => {
    const cfg = readConfig();
    if (!cfg) {
      process.stderr.write(
        'Config not found. Run:\n  happycode init --base-url <url> --api-key <key> [--model <model>]\n'
      );
      process.exit(1);
    }

    const mode = (options.mode ?? 'plan') as AgentMode;
    if (!SUPPORTED_MODES.includes(mode)) {
      process.stderr.write(`Invalid mode: ${mode}. Allowed: ${SUPPORTED_MODES.join(', ')}\n`);
      process.exit(1);
    }

    const agent = new HappyCodeAgent(cfg);
    const mcpManager = new McpClientManager();
    const mcpConfig = loadMcpConfig(process.cwd());
    await mcpManager.ensureServers(mcpConfig);
    const mcpTools = await mcpManager.listTools();
    const maxTurns = Number.parseInt(String(options.maxTurns), 10);
    const allowedTools = String(options.allowedTools ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    const disallowedTools = String(options.disallowedTools ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    const chunks: string[] = [];

    const result = await agent.chatStream(
      [{ role: 'user', content: options.message }],
      {
        mode,
        cwd: process.cwd(),
        model: options.model,
        fallbackModel: options.fallbackModel,
        maxTurns: Number.isFinite(maxTurns) ? maxTurns : 8,
        allowedTools,
        disallowedTools,
        systemPrompt: options.systemPrompt,
        appendSystemPrompt: options.appendSystemPrompt,
        mcpTools,
        mcpCall: (fullName, args) => mcpManager.callTool(fullName, args),
        enableAudit: options.audit !== false
      },
      (delta) => {
        chunks.push(delta);
        if (options.streamJson) {
          process.stdout.write(`${JSON.stringify({ type: 'delta', content: delta })}\n`);
        } else if (!options.json) {
          process.stdout.write(delta);
        }
      },
      (event) => {
        if (options.streamJson) {
          process.stdout.write(`${JSON.stringify({ type: 'tool', event })}\n`);
        } else {
          const marker = event.phase === 'start' ? 'TOOL>' : 'TOOL<';
          const info =
            event.phase === 'start'
              ? JSON.stringify(event.args)
              : `${event.ok ? 'ok' : 'fail'} ${event.preview ?? ''}`;
          process.stderr.write(`${marker} ${event.name} ${info}\n`);
        }
      }
    );

    if (options.json) {
      process.stdout.write(
        `${JSON.stringify({
          mode,
          message: options.message,
          output: result,
          chunks
        }, null, 2)}\n`
      );
    } else if (!options.streamJson && !result.endsWith('\n')) {
      process.stdout.write('\n');
    }

    await mcpManager.shutdown();
  });

program
  .command('agents')
  .description('Run multi-agent orchestration tasks')
  .requiredOption('-m, --message <text>', 'Base user prompt')
  .action(async (options) => {
    const cfg = readConfig();
    if (!cfg) {
      process.stderr.write(
        'Config not found. Run:\n  happycode init --base-url <url> --api-key <key> [--model <model>]\n'
      );
      process.exit(1);
    }

    const agent = new HappyCodeAgent(cfg);
    const runtime = new MultiAgentRuntime(agent);
    const results = await runtime.runTasks(
      [{ role: 'user', content: options.message }],
      [
        {
          name: 'planner',
          mode: 'plan',
          prompt: 'Create a detailed implementation plan with risks.'
        },
        {
          name: 'coder',
          mode: 'edit',
          prompt: 'Provide concrete code-level changes to implement the request.'
        },
        {
          name: 'reviewer',
          mode: 'plan',
          prompt: 'Review the proposed approach and list potential issues.'
        }
      ],
      {
        cwd: process.cwd(),
        enableAudit: true,
        maxTurns: 5
      }
    );

    process.stdout.write(`${MultiAgentRuntime.formatResults(results)}\n`);
  });

program
  .command('session')
  .description('Session helpers')
  .option('--clear', 'Clear active session messages')
  .option('--root', 'Print sessions root path')
  .option('--legacy-path', 'Print legacy session file path')
  .option('--list', 'List sessions')
  .option('--new [name]', 'Create and switch to new session')
  .option('--resume <id>', 'Switch active session by id')
  .option('--rename <name>', 'Rename current session')
  .option('--fork [name]', 'Fork current session and switch')
  .option('--rewind <steps>', 'Drop last N messages from current session')
  .action((options) => {
    if (options.root) {
      process.stdout.write(`${getSessionRootPath()}\n`);
      return;
    }

    if (options.legacyPath) {
      process.stdout.write(`${getLegacySessionPath()}\n`);
      return;
    }

    if (options.list) {
      process.stdout.write(`${JSON.stringify(listSessions(process.cwd()), null, 2)}\n`);
      return;
    }

    if (options.new) {
      const created = createSession(typeof options.new === 'string' ? options.new : 'new', process.cwd());
      process.stdout.write(`${JSON.stringify(created, null, 2)}\n`);
      return;
    }

    if (options.resume) {
      const resumed = switchSession(String(options.resume), process.cwd());
      if (!resumed) {
        process.stderr.write(`Session not found: ${options.resume}\n`);
        process.exit(1);
      }
      process.stdout.write(`${JSON.stringify(resumed, null, 2)}\n`);
      return;
    }

    if (options.rename) {
      const renamed = renameActiveSession(String(options.rename), process.cwd());
      process.stdout.write(`${JSON.stringify(renamed, null, 2)}\n`);
      return;
    }

    if (options.fork) {
      const forked = forkActiveSession(typeof options.fork === 'string' ? options.fork : undefined, process.cwd());
      process.stdout.write(`${JSON.stringify(forked, null, 2)}\n`);
      return;
    }

    if (options.rewind) {
      const steps = Number.parseInt(String(options.rewind), 10);
      const rewound = rewindActiveSession(Number.isFinite(steps) ? steps : 1, process.cwd());
      process.stdout.write(`${JSON.stringify(rewound, null, 2)}\n`);
      return;
    }

    if (options.clear) {
      clearSession(process.cwd());
      process.stdout.write('Active session cleared.\n');
      return;
    }

    process.stdout.write(
      `${JSON.stringify({
        active: loadActiveSession(process.cwd()),
        messages: loadSessionMessages(process.cwd()).length
      }, null, 2)}\n`
    );
  });

program
  .command('audit')
  .description('Audit log helpers')
  .option('--path', 'Print audit log path')
  .option('--tail <n>', 'Print latest n audit records', '20')
  .action((options) => {
    if (options.path) {
      process.stdout.write(`${getAuditPath()}\n`);
      return;
    }

    const n = Number.parseInt(String(options.tail), 10);
    const records = readRecentAudit(Number.isFinite(n) ? n : 20);
    if (records.length === 0) {
      process.stdout.write('No audit records found.\n');
      return;
    }
    process.stdout.write(`${JSON.stringify(records, null, 2)}\n`);
  });

program
  .command('policy')
  .description('Policy file helpers')
  .option('--path', 'Print policy file path')
  .option('--init', 'Create default policy file if missing')
  .action((options) => {
    if (options.path) {
      process.stdout.write(`${getPolicyPath(process.cwd())}\n`);
      return;
    }
    if (options.init) {
      const p = writeDefaultPolicy(process.cwd());
      process.stdout.write(`Policy ready: ${p}\n`);
      return;
    }
    process.stdout.write('Use --path or --init\n');
  });

program
  .command('approvals')
  .description('Command approval helpers')
  .option('--path', 'Print approvals storage path')
  .option('--list', 'List approved prefixes')
  .option('--clear', 'Clear approved prefixes')
  .action((options) => {
    if (options.path) {
      process.stdout.write(`${getApprovalPath()}\n`);
      return;
    }
    if (options.list) {
      process.stdout.write(`${JSON.stringify(getApprovalPrefixes(), null, 2)}\n`);
      return;
    }
    if (options.clear) {
      clearCommandApprovals();
      process.stdout.write('Cleared approvals.\n');
      return;
    }
    process.stdout.write('Use --path, --list, or --clear\n');
  });

if (process.argv.length === 2) {
  process.argv.push('run');
}

program.parse();
