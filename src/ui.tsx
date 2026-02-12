import fs from 'node:fs';
import path from 'node:path';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import type { HappyCodeAgent, ChatMessage, ToolEvent } from './agent.js';
import { allowCommandPrefix, clearCommandApprovals, getApprovalPath, getApprovalPrefixes } from './approvals.js';
import { readRecentAudit, getAuditPath } from './audit.js';
import { getConfigPath, readConfig } from './config.js';
import { clearMemory, getMemoryPath, readMemory } from './memory.js';
import { loadMcpConfig, getMcpConfigPath, initMcpConfig } from './mcp.js';
import type { McpClientManager } from './mcp_client.js';
import { SUPPORTED_MODES, type AgentMode } from './modes.js';
import { getPolicyPath, writeDefaultPolicy } from './policy.js';
import {
  listSessions,
  loadActiveSession,
  loadSessionToolEvents,
  renameActiveSession,
  rewindActiveSession,
  saveSessionMessages,
  saveSessionToolEvents,
  switchSession
} from './session.js';
import { MultiAgentRuntime } from './agents_runtime.js';

type Props = {
  agent: HappyCodeAgent;
  initialHistory?: ChatMessage[];
  onHistoryChange?: (messages: ChatMessage[]) => void;
  defaultMode?: AgentMode;
  enableAudit?: boolean;
  defaultModel?: string;
  appVersion?: string;
  defaultRuntime?: Partial<RuntimeOptions>;
  mcpManager?: McpClientManager;
};

type RuntimeOptions = {
  mode: AgentMode;
  model?: string;
  fallbackModel?: string;
  maxTurns: number;
  allowedTools: string[];
  disallowedTools: string[];
  systemPrompt?: string;
  appendSystemPrompt?: string;
};

type ToolTimelineEvent = ToolEvent & {
  seq: number;
  ts: number;
  turn: number;
};

type ToolStep = {
  id: number;
  turn: number;
  name: string;
  args: Record<string, unknown>;
  status: 'running' | 'done' | 'failed';
  preview?: string;
  endedAt?: number;
};

type ThemeName = 'black-yellow' | 'cyber' | 'minimal';

const THEME_STYLES: Record<
  ThemeName,
  {
    titleColor: 'yellow' | 'cyan' | 'green';
    subtitleColor: 'cyan' | 'magenta' | 'gray';
    metaColor: 'white' | 'cyan' | 'green';
    icon: string;
    spark: string;
  }
> = {
  'black-yellow': {
    titleColor: 'yellow',
    subtitleColor: 'cyan',
    metaColor: 'white',
    icon: ':)',
    spark: '✨'
  },
  cyber: {
    titleColor: 'cyan',
    subtitleColor: 'magenta',
    metaColor: 'cyan',
    icon: '>>',
    spark: '⚡'
  },
  minimal: {
    titleColor: 'green',
    subtitleColor: 'gray',
    metaColor: 'white',
    icon: ':|',
    spark: '-'
  }
};

type CommandDef = { cmd: string; complete: string; desc: string };
type InputSuggestion = {
  label: string;
  insert: string;
  desc: string;
  kind: 'command' | 'option';
};

const COMMANDS: CommandDef[] = [
  { cmd: '/help', complete: '/help', desc: 'Show command help' },
  { cmd: '/status', complete: '/status', desc: 'Show runtime status' },
  { cmd: '/config', complete: '/config', desc: 'Show loaded config and runtime overrides' },
  { cmd: '/new', complete: '/new', desc: 'Start new conversation' },
  { cmd: '/compact', complete: '/compact', desc: 'Compact context' },
  { cmd: '/review', complete: '/review', desc: 'Review current git diff' },
  { cmd: '/plan', complete: '/plan', desc: 'Generate implementation plan' },
  { cmd: '/test [command]', complete: '/test', desc: 'Run tests via tools' },
  { cmd: '/fix', complete: '/fix', desc: 'Investigate and fix issues' },
  { cmd: '/mode ask|plan|edit|auto', complete: '/mode ', desc: 'Switch mode' },
  { cmd: '/theme', complete: '/theme ', desc: 'Get or set UI theme' },
  { cmd: '/model [name]', complete: '/model ', desc: 'Get or set model' },
  { cmd: '/permissions', complete: '/permissions', desc: 'Show tool permission config' },
  { cmd: '/permissions allow <tool>', complete: '/permissions allow ', desc: 'Allow specific tool' },
  { cmd: '/permissions deny <tool>', complete: '/permissions deny ', desc: 'Deny specific tool' },
  { cmd: '/permissions clear', complete: '/permissions clear', desc: 'Clear tool restrictions' },
  { cmd: '/resume [sessionId]', complete: '/resume ', desc: 'Switch session' },
  { cmd: '/rewind <n>', complete: '/rewind ', desc: 'Drop last N messages' },
  { cmd: '/rename <name>', complete: '/rename ', desc: 'Rename current session' },
  { cmd: '/export [path]', complete: '/export ', desc: 'Export transcript' },
  { cmd: '/context', complete: '/context', desc: 'Show context summary' },
  { cmd: '/stats', complete: '/stats', desc: 'Show local usage stats from audit log' },
  { cmd: '/usage', complete: '/usage', desc: 'Alias for /stats' },
  { cmd: '/tasks', complete: '/tasks', desc: 'Summarize pending tasks' },
  { cmd: '/todos', complete: '/todos', desc: 'Generate TODO checklist' },
  { cmd: '/copy', complete: '/copy', desc: 'Copy latest assistant response' },
  { cmd: '/debug', complete: '/debug', desc: 'Show debug info' },
  { cmd: '/doctor', complete: '/doctor', desc: 'Run environment checks' },
  { cmd: '/memory', complete: '/memory', desc: 'Show memory notes' },
  { cmd: '/memory clear', complete: '/memory clear', desc: 'Clear memory notes' },
  { cmd: '/mcp', complete: '/mcp', desc: 'Show MCP config status' },
  { cmd: '/mcp init', complete: '/mcp init', desc: 'Create MCP config' },
  { cmd: '/agents [prompt]', complete: '/agents ', desc: 'Run multi-agent orchestration' },
  { cmd: '/audit', complete: '/audit', desc: 'Show recent audit logs' },
  { cmd: '/allow once <command>', complete: '/allow once ', desc: 'Approve shell command prefix quickly' },
  { cmd: '/allow session <prefix>', complete: '/allow session ', desc: 'Approve shell prefix for session' },
  { cmd: '/approvals', complete: '/approvals', desc: 'Show command approvals' },
  { cmd: '/approvals clear', complete: '/approvals clear', desc: 'Clear command approvals' },
  { cmd: '/policy init', complete: '/policy init', desc: 'Create policy file' },
  { cmd: '/policy path', complete: '/policy path', desc: 'Show policy path' },
  { cmd: '/init', complete: '/init', desc: 'Show important file paths' },
  { cmd: '/clear', complete: '/clear', desc: 'Clear conversation' },
  { cmd: '/exit', complete: '/exit', desc: 'Quit' }
];

const HELP_TEXT = COMMANDS.map((item) => `${item.cmd.padEnd(34, ' ')} ${item.desc}`).join('\n');
const MAX_RENDER_FLOW_ITEMS = 120;
const MAX_TOOL_EVENTS_STORE = 2000;
const MAX_PREVIEW_LINES = 5;
const MAX_PREVIEW_CHARS = 560;

function formatToolTag(name: string): string {
  const short = name.startsWith('mcp__') ? name.replace(/^mcp__/, '').replace(/__/g, '/') : name;
  return short.length > 28 ? `${short.slice(0, 27)}...` : short;
}

function getToolTagColor(name: string): 'cyan' | 'blue' | 'magenta' | 'yellow' | 'green' | 'red' {
  if (name.includes('shell') || name.includes('command')) {
    return 'yellow';
  }
  if (name.includes('file') || name.includes('read') || name.includes('write')) {
    return 'cyan';
  }
  if (name.includes('git')) {
    return 'magenta';
  }
  if (name.startsWith('mcp__')) {
    return 'blue';
  }
  if (name.includes('test')) {
    return 'green';
  }
  return 'red';
}

function getResultTypeBadge(step: ToolStep): { icon: string; label: string } {
  const preview = (step.preview ?? '').toLowerCase();
  const name = step.name.toLowerCase();

  if (name.includes('test') || preview.includes('test') || preview.includes('passed') || preview.includes('failed')) {
    return { icon: '[T]', label: 'test' };
  }
  if (name.includes('diff') || preview.includes('diff') || preview.includes('@@') || preview.includes('+++')) {
    return { icon: '[D]', label: 'diff' };
  }
  if (name.includes('shell') || name.includes('command') || preview.includes('exit code')) {
    return { icon: '💻', label: 'command' };
  }
  if (name.includes('read') || name.includes('write') || name.includes('file') || preview.includes('path')) {
    return { icon: '[F]', label: 'file' };
  }
  if (name.startsWith('mcp__')) {
    return { icon: '[M]', label: 'mcp' };
  }
  if (preview.startsWith('{') || preview.startsWith('[')) {
    return { icon: '[J]', label: 'json' };
  }
  return { icon: '[R]', label: 'result' };
}

function toPreviewText(text: string, maxLines = MAX_PREVIEW_LINES, maxChars = MAX_PREVIEW_CHARS): string {
  const normalized = text.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n').slice(0, maxLines);
  const merged = lines.join('\n');
  if (merged.length > maxChars) {
    return `${merged.slice(0, maxChars)}...`;
  }
  if (normalized.length > merged.length) {
    return `${merged}\n...`;
  }
  return merged;
}

function buildOptionSuggestions(
  inputValue: string,
  prefix: string,
  options: string[],
  desc: string
): InputSuggestion[] {
  if (!inputValue.startsWith(prefix)) {
    return [];
  }
  const partial = inputValue.slice(prefix.length).trim();
  const needle = partial.toLowerCase();
  return options
    .filter((item) => item.toLowerCase().startsWith(needle))
    .map((item) => ({
      label: `${prefix}${item}`,
      insert: `${prefix}${item}`,
      desc,
      kind: 'option' as const
    }));
}

function getCommandParamHint(command: CommandDef): string {
  if (!command.complete.endsWith(' ')) {
    return '';
  }
  const raw = command.cmd.startsWith(command.complete) ? command.cmd.slice(command.complete.length).trim() : '';
  return raw;
}

function getInlineParamPlaceholder(input: string): string {
  const matched = COMMANDS.find((item) => item.complete.endsWith(' ') && input === item.complete);
  if (!matched) {
    return '';
  }
  return getCommandParamHint(matched);
}

function pushAssistant(
  text: string,
  setHistory: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
  onHistoryChange?: (messages: ChatMessage[]) => void
): void {
  setHistory((prev) => {
    const assistantMessage: ChatMessage = { role: 'assistant', content: text };
    const updated = [...prev, assistantMessage];
    onHistoryChange?.(updated);
    return updated;
  });
}

function parseMentionFiles(input: string, cwd: string): string[] {
  const matches = [...input.matchAll(/@([^\s]+)/g)].map((m) => m[1]).filter(Boolean);
  const files: string[] = [];
  for (const item of matches) {
    const full = path.resolve(cwd, item);
    if (fs.existsSync(full) && fs.statSync(full).isFile()) {
      files.push(item);
    }
  }
  return files;
}

export function App({
  agent,
  initialHistory = [],
  onHistoryChange,
  defaultMode = 'auto',
  enableAudit = true,
  defaultModel,
  appVersion = '0.1.0',
  defaultRuntime,
  mcpManager
}: Props): React.JSX.Element {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [terminalColumns, setTerminalColumns] = useState<number>(stdout.columns ?? 80);
  const [history, setHistory] = useState<ChatMessage[]>(initialHistory);
  const [input, setInput] = useState('');
  const [runtime, setRuntime] = useState<RuntimeOptions>({
    mode: defaultRuntime?.mode ?? defaultMode,
    model: defaultRuntime?.model ?? defaultModel,
    fallbackModel: defaultRuntime?.fallbackModel,
    maxTurns: defaultRuntime?.maxTurns ?? 8,
    allowedTools: defaultRuntime?.allowedTools ?? [],
    disallowedTools: defaultRuntime?.disallowedTools ?? [],
    systemPrompt: defaultRuntime?.systemPrompt,
    appendSystemPrompt: defaultRuntime?.appendSystemPrompt
  });
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState('');
  const [toolEvents, setToolEvents] = useState<ToolTimelineEvent[]>([]);
  const [theme, setTheme] = useState<ThemeName>('black-yellow');
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [inputKey, setInputKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const toolSeqRef = useRef(0);
  const toolTurnRef = useRef(0);
  const toolEventsHydratedRef = useRef(false);
  const streamingBufferRef = useRef('');
  const streamingFlushTimerRef = useRef<NodeJS.Timeout | null>(null);

  const themeStyle = THEME_STYLES[theme];
  const projectName = useMemo(() => path.basename(process.cwd()), []);
  const contentWidth = useMemo(() => Math.max(24, terminalColumns - 2), [terminalColumns]);
  const flowSeparator = useMemo(() => '-'.repeat(contentWidth), [contentWidth]);

  useEffect(() => {
    const handleResize = () => {
      setTerminalColumns(stdout.columns ?? 80);
    };
    handleResize();
    stdout.on('resize', handleResize);
    return () => {
      stdout.off('resize', handleResize);
    };
  }, [stdout]);

  useEffect(
    () => () => {
      if (streamingFlushTimerRef.current) {
        clearTimeout(streamingFlushTimerRef.current);
      }
    },
    []
  );

  useEffect(() => {
    const persisted = loadSessionToolEvents() as ToolTimelineEvent[];
    setToolEvents(persisted);
    if (persisted.length > 0) {
      const maxSeq = persisted.reduce((max, item) => (item.seq > max ? item.seq : max), 0);
      const maxTurn = persisted.reduce((max, item) => (item.turn > max ? item.turn : max), 0);
      toolSeqRef.current = maxSeq;
      toolTurnRef.current = maxTurn;
    }
    toolEventsHydratedRef.current = true;
  }, []);

  useEffect(() => {
    if (!toolEventsHydratedRef.current) {
      return;
    }
    saveSessionToolEvents(toolEvents as Parameters<typeof saveSessionToolEvents>[0]);
  }, [toolEvents]);

  const setInputAtEnd = useCallback((value: string) => {
    setInput(value);
    setInputKey((prev) => prev + 1);
  }, []);

  const inputSuggestions = useMemo(() => {
    const trimmed = input.trim();
    if (!trimmed.startsWith('/')) {
      return [] as InputSuggestion[];
    }

    const optionSuggestions = [
      ...buildOptionSuggestions(input, '/mode ', ['ask', 'plan', 'edit', 'auto'], 'Select mode'),
      ...buildOptionSuggestions(input, '/theme ', ['black-yellow', 'cyber', 'minimal'], 'Select theme'),
      ...buildOptionSuggestions(
        input,
        '/permissions allow ',
        ['list_files', 'read_file', 'write_file', 'append_file', 'patch_file', 'delete_file', 'search_in_files', 'run_shell', 'git_status', 'git_diff', 'git_log'],
        'Allow tool'
      ),
      ...buildOptionSuggestions(
        input,
        '/permissions deny ',
        ['list_files', 'read_file', 'write_file', 'append_file', 'patch_file', 'delete_file', 'search_in_files', 'run_shell', 'git_status', 'git_diff', 'git_log'],
        'Deny tool'
      )
    ];

    if (optionSuggestions.length > 0) {
      return optionSuggestions.slice(0, 8);
    }

    const needle = trimmed.toLowerCase();
    return COMMANDS.filter((item) => item.cmd.toLowerCase().startsWith(needle))
      .map((item) => ({
        label: item.cmd,
        insert: item.complete,
        desc: item.desc,
        kind: 'command' as const
      }))
      .slice(0, 8);
  }, [input]);

  const inlineParamPlaceholder = useMemo(() => getInlineParamPlaceholder(input), [input]);

  useEffect(() => {
    setSuggestionIndex((prev) => {
      if (inputSuggestions.length === 0) {
        return 0;
      }
      return Math.min(prev, inputSuggestions.length - 1);
    });
  }, [inputSuggestions]);

  useInput((inputKey, key) => {
    if (key.escape) {
      setInputAtEnd('');
      setError(null);
      return;
    }

    if (inputSuggestions.length === 0) {
      return;
    }

    if (key.upArrow) {
      setSuggestionIndex((prev) => (prev - 1 + inputSuggestions.length) % inputSuggestions.length);
      return;
    }

    if (key.downArrow) {
      setSuggestionIndex((prev) => (prev + 1) % inputSuggestions.length);
      return;
    }

    if (key.tab) {
      const selected = inputSuggestions[suggestionIndex];
      if (!selected) {
        return;
      }
      const nextInput =
        selected.kind === 'command'
          ? selected.insert.endsWith(' ')
            ? selected.insert
            : `${selected.insert} `
          : selected.insert;
      setInputAtEnd(nextInput);
    }
  });

  const runAgentTask = useCallback(
    async (taskPrompt: string, modeOverride?: AgentMode): Promise<void> => {
      const mentionFiles = parseMentionFiles(taskPrompt, process.cwd());
      let enhancedPrompt = taskPrompt;
      if (mentionFiles.length > 0) {
        const inline = mentionFiles
          .map((file) => {
            const full = path.resolve(process.cwd(), file);
            const content = fs.readFileSync(full, 'utf8').slice(0, 20_000);
            return `\n[FILE: ${file}]\n${content}`;
          })
          .join('\n');
        enhancedPrompt = `${taskPrompt}\n\nReferenced files content:${inline}`;
      }

      const userMessage: ChatMessage = { role: 'user', content: enhancedPrompt };
      const nextHistory: ChatMessage[] = [...history, userMessage];
      setHistory(nextHistory);
      onHistoryChange?.(nextHistory);

      setLoading(true);
      setStreaming('');
      streamingBufferRef.current = '';
      if (streamingFlushTimerRef.current) {
        clearTimeout(streamingFlushTimerRef.current);
        streamingFlushTimerRef.current = null;
      }
      const currentTurn = nextHistory.filter((item) => item.role === 'user').length;
      toolTurnRef.current += 1;

      setToolEvents((prev) => {
        const divider: ToolTimelineEvent = {
          source: 'runtime',
          phase: 'start',
          name: `turn_marker_${toolTurnRef.current}`,
          args: { prompt: taskPrompt },
          seq: ++toolSeqRef.current,
          ts: Date.now(),
          turn: currentTurn
        };
        return [...prev.slice(-(MAX_TOOL_EVENTS_STORE - 1)), divider];
      });

      try {
        const mcpTools = mcpManager ? await mcpManager.listTools() : [];
        const reply = await agent.chatStream(
          nextHistory,
          {
            mode: modeOverride ?? runtime.mode,
            cwd: process.cwd(),
            enableAudit,
            model: runtime.model,
            fallbackModel: runtime.fallbackModel,
            maxTurns: runtime.maxTurns,
            allowedTools: runtime.allowedTools,
            disallowedTools: runtime.disallowedTools,
            systemPrompt: runtime.systemPrompt,
            appendSystemPrompt: runtime.appendSystemPrompt,
            mcpTools,
            mcpCall: mcpManager
              ? (fullName, args) => mcpManager.callTool(fullName, args)
              : undefined
          },
          (delta) => {
            streamingBufferRef.current += delta;
            if (!streamingFlushTimerRef.current) {
              streamingFlushTimerRef.current = setTimeout(() => {
                setStreaming(streamingBufferRef.current);
                streamingFlushTimerRef.current = null;
              }, 60);
            }
          },
          (event) => {
            const timelineEvent: ToolTimelineEvent = {
              ...event,
              seq: ++toolSeqRef.current,
              ts: Date.now(),
              turn: currentTurn
            };
            setToolEvents((prev) => [...prev.slice(-(MAX_TOOL_EVENTS_STORE - 1)), timelineEvent]);
          }
        );

        setHistory((prev) => {
          const assistantMessage: ChatMessage = { role: 'assistant', content: reply };
          const updated = [...prev, assistantMessage];
          onHistoryChange?.(updated);
          return updated;
        });
        if (streamingFlushTimerRef.current) {
          clearTimeout(streamingFlushTimerRef.current);
          streamingFlushTimerRef.current = null;
        }
        setStreaming(streamingBufferRef.current);
        setStreaming('');
        streamingBufferRef.current = '';
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (streamingFlushTimerRef.current) {
          clearTimeout(streamingFlushTimerRef.current);
          streamingFlushTimerRef.current = null;
        }
        setLoading(false);
      }
    },
    [agent, enableAudit, history, onHistoryChange, runtime]
  );

  const handleSlashCommand = useCallback(
    (content: string): boolean => {
      if (content === '/help') {
        pushAssistant(HELP_TEXT, setHistory, onHistoryChange);
        return true;
      }

      if (content === '/status') {
        const active = loadActiveSession(process.cwd());
        const status = [
          `mode: ${runtime.mode}`,
          `model: ${runtime.model ?? '(default)'}`,
          `fallback_model: ${runtime.fallbackModel ?? '(none)'}`,
          `max_turns: ${runtime.maxTurns}`,
          `cwd: ${process.cwd()}`,
          `audit: ${enableAudit ? 'on' : 'off'}`,
          `history_messages: ${history.length}`,
          'tool_details: always',
          `theme: ${theme}`,
          `active_session: ${active.id} (${active.name})`
        ].join('\n');
        pushAssistant(status, setHistory, onHistoryChange);
        return true;
      }

      if (content === '/theme') {
        pushAssistant(
          `Current theme: ${theme}\nAvailable: ${Object.keys(THEME_STYLES).join(', ')}`,
          setHistory,
          onHistoryChange
        );
        return true;
      }

      if (content.startsWith('/theme ')) {
        const next = content.replace('/theme ', '').trim() as ThemeName;
        if (!(next in THEME_STYLES)) {
          pushAssistant(`Invalid theme: ${next}\nAvailable: ${Object.keys(THEME_STYLES).join(', ')}`, setHistory, onHistoryChange);
          return true;
        }
        setTheme(next);
        pushAssistant(`Theme switched to: ${next}`, setHistory, onHistoryChange);
        return true;
      }

      if (content === '/config') {
        const payload = {
          configPath: getConfigPath(),
          config: readConfig(),
          runtime
        };
        pushAssistant(JSON.stringify(payload, null, 2), setHistory, onHistoryChange);
        return true;
      }

      if (content === '/context') {
        const info = [
          `message_count: ${history.length}`,
          `last_user: ${[...history].reverse().find((m) => m.role === 'user')?.content?.slice(0, 160) ?? '(none)'}`,
          `last_assistant: ${[...history].reverse().find((m) => m.role === 'assistant')?.content?.slice(0, 160) ?? '(none)'}`
        ].join('\n');
        pushAssistant(info, setHistory, onHistoryChange);
        return true;
      }

      if (content === '/debug') {
        const debugInfo = {
          runtime,
          commandSuggestions: inputSuggestions.map((item) => item.label),
          activeSession: loadActiveSession(process.cwd()),
          cwd: process.cwd()
        };
        pushAssistant(JSON.stringify(debugInfo, null, 2), setHistory, onHistoryChange);
        return true;
      }

      if (content === '/stats' || content === '/usage') {
        const logs = readRecentAudit(300);
        const byTool = logs.reduce<Record<string, number>>((acc, item) => {
          acc[item.tool] = (acc[item.tool] ?? 0) + 1;
          return acc;
        }, {});
        const summary = {
          totalEvents: logs.length,
          success: logs.filter((x) => x.ok).length,
          failed: logs.filter((x) => !x.ok).length,
          byTool
        };
        pushAssistant(JSON.stringify(summary, null, 2), setHistory, onHistoryChange);
        return true;
      }

      if (content === '/doctor') {
        const checks = [
          `config_exists: ${fs.existsSync(getConfigPath())}`,
          `policy_exists: ${fs.existsSync(getPolicyPath(process.cwd()))}`,
          `mcp_exists: ${fs.existsSync(getMcpConfigPath(process.cwd()))}`,
          `memory_exists: ${fs.existsSync(getMemoryPath())}`,
          `audit_exists: ${fs.existsSync(getAuditPath())}`
        ].join('\n');
        pushAssistant(checks, setHistory, onHistoryChange);
        return true;
      }

      if (content === '/new') {
        setHistory([]);
        onHistoryChange?.([]);
        setToolEvents([]);
        toolSeqRef.current = 0;
        toolTurnRef.current = 0;
        pushAssistant('Started a new conversation.', setHistory, onHistoryChange);
        return true;
      }

      if (content === '/compact') {
        setHistory((prev) => {
          const compacted = prev.slice(-6);
          onHistoryChange?.(compacted);
          return compacted;
        });
        pushAssistant('Compacted context to latest 6 messages.', setHistory, onHistoryChange);
        return true;
      }

      if (content === '/review') {
        void runAgentTask(
          'Please review the current repository changes. Use git_status and git_diff tools first, then provide: summary, potential bugs, security risks, and actionable fixes.',
          'ask'
        );
        return true;
      }

      if (content === '/plan') {
        void runAgentTask(
          'Please produce a concrete implementation plan for the current task. Focus on ordered steps, risks, and validation strategy.',
          'plan'
        );
        return true;
      }

      if (content.startsWith('/test')) {
        const custom = content.replace('/test', '').trim();
        const testPrompt = custom
          ? `Run this test command with tools: ${custom}. Summarize failures and likely root cause.`
          : 'Detect and run the most appropriate test command for this project using tools. Summarize failures and likely root cause.';
        void runAgentTask(testPrompt, 'auto');
        return true;
      }

      if (content === '/fix') {
        void runAgentTask(
          'Investigate current project issues using available tools, implement a minimal fix, and explain what was changed and why.',
          'auto'
        );
        return true;
      }

      if (content === '/tasks') {
        void runAgentTask('List pending implementation tasks with priorities and next action.', 'ask');
        return true;
      }

      if (content === '/todos') {
        void runAgentTask('Generate concise TODO checklist using markdown task items.', 'ask');
        return true;
      }

      if (content === '/copy') {
        const latest = [...history].reverse().find((item) => item.role === 'assistant')?.content;
        if (!latest) {
          pushAssistant('No assistant message to copy.', setHistory, onHistoryChange);
          return true;
        }
        void (async () => {
          try {
            const mod = (await import('clipboardy')) as unknown as { write: (text: string) => Promise<void> };
            await mod.write(latest);
            pushAssistant('Copied latest assistant response to clipboard.', setHistory, onHistoryChange);
          } catch {
            pushAssistant('Clipboard unavailable in this environment.', setHistory, onHistoryChange);
          }
        })();
        return true;
      }

      if (content === '/init') {
        const info = [
          `config: ${getConfigPath()}`,
          `policy: ${getPolicyPath(process.cwd())}`,
          `mcp: ${getMcpConfigPath(process.cwd())}`,
          `memory: ${getMemoryPath()}`,
          `audit: ${getAuditPath()}`,
          `approvals: ${getApprovalPath()}`
        ].join('\n');
        pushAssistant(info, setHistory, onHistoryChange);
        return true;
      }

      if (content === '/clear') {
        setHistory([]);
        onHistoryChange?.([]);
        return true;
      }

      if (content === '/audit') {
        const logs = readRecentAudit(8);
        const summary = logs.length
          ? logs
              .map((item) => `${item.timestamp} [${item.mode}] ${item.tool} ${item.ok ? 'OK' : 'FAIL'} ${item.summary}`)
              .join('\n')
          : `No audit logs. Path: ${getAuditPath()}`;
        pushAssistant(summary, setHistory, onHistoryChange);
        return true;
      }

      if (content === '/memory') {
        const memory = readMemory();
        pushAssistant(memory || `No memory notes. Path: ${getMemoryPath()}`, setHistory, onHistoryChange);
        return true;
      }

      if (content === '/memory clear') {
        clearMemory();
        pushAssistant('Memory cleared.', setHistory, onHistoryChange);
        return true;
      }

      if (content === '/mcp') {
        const mcp = loadMcpConfig(process.cwd());
        const toolsPromise = mcpManager ? mcpManager.listTools() : Promise.resolve([]);
        void toolsPromise.then((tools) => {
          pushAssistant(
            JSON.stringify(
              {
                config: mcp,
                discoveredTools: tools.map((item) => item.fullName)
              },
              null,
              2
            ),
            setHistory,
            onHistoryChange
          );
        });
        return true;
      }

      if (content === '/mcp init') {
        const p = initMcpConfig(process.cwd());
        pushAssistant(`MCP config initialized: ${p}`, setHistory, onHistoryChange);
        return true;
      }

      if (content.startsWith('/agents')) {
        const base = content.replace('/agents', '').trim();
        const prompt = base || 'analyze current project and propose concrete implementation steps';
        void (async () => {
          const runtimeAgent = new MultiAgentRuntime(agent);
          const results = await runtimeAgent.runTasks(
            [{ role: 'user', content: prompt }],
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
                mode: 'ask',
                prompt: 'Review the proposed approach and list potential issues.'
              }
            ],
            {
              cwd: process.cwd(),
              enableAudit,
              maxTurns: runtime.maxTurns
            }
          );
          pushAssistant(MultiAgentRuntime.formatResults(results), setHistory, onHistoryChange);
        })();
        return true;
      }

      if (content.startsWith('/model')) {
        const next = content.replace('/model', '').trim();
        if (!next) {
          pushAssistant(`Current model: ${runtime.model ?? '(default from config)'}`, setHistory, onHistoryChange);
        } else {
          setRuntime((prev) => ({ ...prev, model: next }));
          pushAssistant(`Model set to: ${next}`, setHistory, onHistoryChange);
        }
        return true;
      }

      if (content.startsWith('/mode ')) {
        const next = content.replace('/mode ', '').trim() as AgentMode;
        if (SUPPORTED_MODES.includes(next)) {
          setRuntime((prev) => ({ ...prev, mode: next }));
          setError(null);
          pushAssistant(`Switched mode to: ${next}`, setHistory, onHistoryChange);
        } else {
          setError(`Invalid mode: ${next}. Allowed: ${SUPPORTED_MODES.join(', ')}`);
        }
        return true;
      }

      if (content === '/permissions') {
        const payload = {
          allowedTools: runtime.allowedTools,
          disallowedTools: runtime.disallowedTools
        };
        pushAssistant(JSON.stringify(payload, null, 2), setHistory, onHistoryChange);
        return true;
      }

      if (content.startsWith('/permissions allow ')) {
        const tool = content.replace('/permissions allow ', '').trim();
        if (tool) {
          setRuntime((prev) => ({
            ...prev,
            allowedTools: [...new Set([...prev.allowedTools, tool])],
            disallowedTools: prev.disallowedTools.filter((item) => item !== tool)
          }));
          pushAssistant(`Allowed tool: ${tool}`, setHistory, onHistoryChange);
        }
        return true;
      }

      if (content.startsWith('/permissions deny ')) {
        const tool = content.replace('/permissions deny ', '').trim();
        if (tool) {
          setRuntime((prev) => ({
            ...prev,
            disallowedTools: [...new Set([...prev.disallowedTools, tool])],
            allowedTools: prev.allowedTools.filter((item) => item !== tool)
          }));
          pushAssistant(`Denied tool: ${tool}`, setHistory, onHistoryChange);
        }
        return true;
      }

      if (content === '/permissions clear') {
        setRuntime((prev) => ({ ...prev, allowedTools: [], disallowedTools: [] }));
        pushAssistant('Cleared tool allow/deny lists.', setHistory, onHistoryChange);
        return true;
      }

      if (content === '/resume') {
        const sessions = listSessions(process.cwd())
          .slice(0, 10)
          .map((item) => `${item.id} ${item.name} (${item.updatedAt})`);
        pushAssistant(sessions.length ? sessions.join('\n') : 'No sessions available.', setHistory, onHistoryChange);
        return true;
      }

      if (content.startsWith('/resume ')) {
        const id = content.replace('/resume ', '').trim();
        const switched = switchSession(id, process.cwd());
        if (!switched) {
          pushAssistant(`Session not found: ${id}`, setHistory, onHistoryChange);
          return true;
        }
        setHistory(switched.messages);
        const switchedEvents = (switched.toolEvents ?? []) as ToolTimelineEvent[];
        setToolEvents(switchedEvents);
        toolSeqRef.current = switchedEvents.reduce((max, item) => (item.seq > max ? item.seq : max), 0);
        toolTurnRef.current = switchedEvents.reduce((max, item) => (item.turn > max ? item.turn : max), 0);
        onHistoryChange?.(switched.messages);
        pushAssistant(`Resumed session: ${switched.id} (${switched.name})`, setHistory, onHistoryChange);
        return true;
      }

      if (content.startsWith('/rewind ')) {
        const n = Number.parseInt(content.replace('/rewind ', '').trim(), 10);
        const rewound = rewindActiveSession(Number.isFinite(n) ? n : 1, process.cwd());
        setHistory(rewound.messages);
        onHistoryChange?.(rewound.messages);
        pushAssistant(`Rewound session by ${Number.isFinite(n) ? n : 1} messages.`, setHistory, onHistoryChange);
        return true;
      }

      if (content.startsWith('/rename ')) {
        const next = content.replace('/rename ', '').trim();
        const renamed = renameActiveSession(next, process.cwd());
        pushAssistant(`Renamed session to: ${renamed.name}`, setHistory, onHistoryChange);
        return true;
      }

      if (content.startsWith('/export')) {
        const target = content.replace('/export', '').trim();
        const outputPath = target || path.join(process.cwd(), 'happycode-export.md');
        const body = history
          .map((item) => `## ${item.role.toUpperCase()}\n\n${item.content}`)
          .join('\n\n');
        fs.writeFileSync(outputPath, `${body}\n`, 'utf8');
        pushAssistant(`Exported conversation to: ${outputPath}`, setHistory, onHistoryChange);
        return true;
      }

      if (content === '/approvals') {
        const list = getApprovalPrefixes();
        const msg = list.length
          ? `Approval prefixes:\n${list.map((s) => `- ${s}`).join('\n')}`
          : `No session approvals. Path: ${getApprovalPath()}`;
        pushAssistant(msg, setHistory, onHistoryChange);
        return true;
      }

      if (content === '/approvals clear') {
        clearCommandApprovals();
        pushAssistant('Cleared saved command approvals.', setHistory, onHistoryChange);
        return true;
      }

      if (content.startsWith('/allow once ')) {
        const cmd = content.replace('/allow once ', '').trim();
        const prefix = cmd.split(' ').slice(0, 2).join(' ').trim() || cmd;
        allowCommandPrefix(prefix);
        pushAssistant(`Approved once-like prefix: ${prefix}. You can now retry.`, setHistory, onHistoryChange);
        return true;
      }

      if (content.startsWith('/allow session ')) {
        const prefix = content.replace('/allow session ', '').trim();
        if (!prefix) {
          setError('Usage: /allow session <command-prefix>');
        } else {
          allowCommandPrefix(prefix);
          pushAssistant(`Approved session prefix: ${prefix}`, setHistory, onHistoryChange);
        }
        return true;
      }

      if (content === '/policy init') {
        const p = writeDefaultPolicy(process.cwd());
        pushAssistant(`Policy initialized at: ${p}`, setHistory, onHistoryChange);
        return true;
      }

      if (content === '/policy path') {
        const p = getPolicyPath(process.cwd());
        pushAssistant(`Policy path: ${p}`, setHistory, onHistoryChange);
        return true;
      }

      return false;
    },
    [
      inputSuggestions,
      enableAudit,
      history,
      onHistoryChange,
      runAgentTask,
      runtime
    ]
  );

  const submit = useCallback(async () => {
    const content = input.trim();
    if (!content || loading) {
      return;
    }

    if (content === '/' && inputSuggestions.length > 0) {
      const selected = inputSuggestions[suggestionIndex];
      if (selected) {
        const completion = selected.insert;
        if (completion.endsWith(' ')) {
          setInputAtEnd(completion);
          return;
        }
        const handled = handleSlashCommand(completion.trim());
        if (!handled) {
          pushAssistant(`Unknown command: ${completion.trim()}\nUse /help`, setHistory, onHistoryChange);
        }
        setInput('');
        return;
      }
    }

    if (content === '/exit' || content === '/quit') {
      exit();
      return;
    }

    if (content.startsWith('!')) {
      const cmd = content.slice(1).trim();
      if (!cmd) {
        setError('Usage: !<shell command>');
        return;
      }
      await runAgentTask(`Run shell command and summarize result: ${cmd}`, 'auto');
      setInput('');
      return;
    }

    setError(null);
    setInput('');

    if (content.startsWith('/')) {
      const handled = handleSlashCommand(content);
      if (!handled) {
        pushAssistant(`Unknown command: ${content}\nUse /help`, setHistory, onHistoryChange);
      }
      return;
    }

    await runAgentTask(content);
  }, [
    inputSuggestions,
    exit,
    handleSlashCommand,
    input,
    loading,
    onHistoryChange,
    runAgentTask,
    setInputAtEnd,
    suggestionIndex
  ]);

  const toolTimeline = useMemo(() => {
    return [...toolEvents].sort((a, b) => {
      if (a.ts === b.ts) {
        return a.seq - b.seq;
      }
      return a.ts - b.ts;
    });
  }, [toolEvents]);

  const visibleTimeline = useMemo(
    () => toolTimeline.filter((event) => event.source === 'model' && !event.name.startsWith('turn_marker_')),
    [toolTimeline]
  );

  const activeToolNames = useMemo(() => {
    const active: string[] = [];
    for (const event of visibleTimeline) {
      if (event.phase === 'start') {
        active.push(event.name);
      } else {
        const idx = active.indexOf(event.name);
        if (idx >= 0) {
          active.splice(idx, 1);
        }
      }
    }
    return active;
  }, [visibleTimeline]);

  const toolSteps = useMemo(() => {
    const steps: ToolStep[] = [];
    const runningByName = new Map<string, number[]>();

    for (const event of visibleTimeline) {
      if (event.phase === 'start') {
        const stepIndex = steps.push({
          id: event.seq,
          turn: event.turn,
          name: event.name,
          args: event.args,
          status: 'running'
        }) - 1;
        const queue = runningByName.get(event.name) ?? [];
        queue.push(stepIndex);
        runningByName.set(event.name, queue);
        continue;
      }

      const queue = runningByName.get(event.name) ?? [];
      const stepIndex = queue.shift();
      if (stepIndex === undefined) {
        continue;
      }
      runningByName.set(event.name, queue);

      const current = steps[stepIndex];
      if (!current) {
        continue;
      }

      current.status = event.ok ? 'done' : 'failed';
      current.preview = event.preview;
      current.endedAt = event.ts;
    }

    return steps;
  }, [visibleTimeline]);

  const toolStepsByTurn = useMemo(() => {
    const grouped = new Map<number, ToolStep[]>();
    for (const step of toolSteps) {
      const bucket = grouped.get(step.turn) ?? [];
      bucket.push(step);
      grouped.set(step.turn, bucket);
    }
    return grouped;
  }, [toolSteps]);

  const conversationFlow = useMemo(() => {
    const rows: Array<
      | { kind: 'message'; key: string; role: 'user' | 'assistant'; content: string }
      | { kind: 'tool'; key: string; step: ToolStep }
    > = [];

    let turn = 0;
    const visibleMessages = history.filter((item) => item.role !== 'system');
    for (let idx = 0; idx < visibleMessages.length; idx += 1) {
      const item = visibleMessages[idx];
      if (item.role === 'system') {
        continue;
      }
      if (item.role === 'user') {
        turn += 1;
      }

      rows.push({
        kind: 'message',
        key: `msg-${idx}`,
        role: item.role,
        content: item.content
      });

      if (item.role === 'user') {
        const turnSteps = toolStepsByTurn.get(turn) ?? [];
        for (const step of turnSteps) {
          rows.push({
            kind: 'tool',
            key: `tool-step-${step.id}`,
            step
          });
        }
      }
    }

    return rows.slice(-MAX_RENDER_FLOW_ITEMS);
  }, [history, toolStepsByTurn]);

  return (
    <Box flexDirection="column" padding={1}>
      <Box borderStyle="round" borderColor={themeStyle.titleColor} paddingX={1} flexDirection="column" width={contentWidth}>
        <Text color={themeStyle.titleColor}>:) HappyCode</Text>
        <Text color={themeStyle.metaColor}>Project: {projectName}</Text>
        <Text color={themeStyle.metaColor}>Model: {runtime.model ?? '(default)'}</Text>
        <Text color={themeStyle.metaColor}>Version: {appVersion}</Text>
      </Box>
      <Box marginTop={1} flexDirection="column" width={contentWidth}>
        {conversationFlow.map((row) => {
          if (row.kind === 'message') {
            return (
              <Box key={row.key} flexDirection="column" width={contentWidth}>
                <Text color={row.role === 'user' ? 'cyan' : 'white'}>{row.content.replace(/\r\n/g, '\n')}</Text>
                <Text color="gray">{flowSeparator}</Text>
              </Box>
            );
          }

          const step = row.step;
          const effectiveStatus = step.status === 'running' && !loading ? 'interrupted' : step.status;
          const statusColor =
            effectiveStatus === 'running'
              ? 'blue'
              : effectiveStatus === 'done'
                ? 'green'
                : effectiveStatus === 'interrupted'
                  ? 'yellow'
                  : 'red';
          const badge = getResultTypeBadge(step);
          const runningDetail = `Args: ${JSON.stringify(step.args)}`;
          const finishedDetail = `Result: ${step.preview ?? '(no output)'}`;
          const baseDetail = effectiveStatus === 'running' ? runningDetail : finishedDetail;

            return (
              <Box key={row.key} flexDirection="column" width={contentWidth}>
                <Box borderStyle="round" borderColor={statusColor} paddingX={1} flexDirection="column">
                <Box>
                  <Text color={statusColor}>
                    {effectiveStatus === 'running' ? (
                      'Running tool'
                    ) : effectiveStatus === 'done' ? (
                      'Tool completed'
                    ) : effectiveStatus === 'interrupted' ? (
                      'Tool interrupted'
                    ) : (
                      'Tool failed'
                    )}
                  </Text>
                  <Text color={getToolTagColor(step.name)}> [{formatToolTag(step.name)}]</Text>
                  <Text color="gray"> {badge.icon} {badge.label}</Text>
                </Box>
                <Text color="gray">
                  {toPreviewText(baseDetail, 10, 1200)}
                </Text>
              </Box>
              <Text color="gray">{flowSeparator}</Text>
            </Box>
          );
        })}
        {loading && streaming ? (
          <Box flexDirection="column" width={contentWidth}>
            <Text>{streaming.replace(/\r\n/g, '\n')}</Text>
            <Text color="gray">{flowSeparator}</Text>
          </Box>
        ) : null}
      </Box>

      {loading ? (
        <Box marginTop={1}>
          <Text color="yellow">Thinking...</Text>
        </Box>
      ) : null}

      {error ? (
        <Box marginTop={1}>
          <Text color="red">Error: {error}</Text>
        </Box>
      ) : null}

      <Box marginTop={1} flexDirection="column" width={contentWidth}>
        <Text color="gray">{flowSeparator}</Text>
        <Box>
          <Text color="green">{'>'}</Text>
          <TextInput key={inputKey} value={input} onChange={setInput} onSubmit={submit} />
          {inlineParamPlaceholder ? <Text color="gray">{inlineParamPlaceholder}</Text> : null}
        </Box>
      </Box>

      {inputSuggestions.length > 0 ? (
        <Box flexDirection="column">
          <Text color="white">Command Hints</Text>
          {inputSuggestions.map((item, idx) => (
            <Text key={item.label} color={idx === suggestionIndex ? 'cyan' : 'white'}>
              {item.label} - {item.desc}
            </Text>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}
