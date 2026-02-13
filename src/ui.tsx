import fs from 'node:fs';
import path from 'node:path';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import type { HappyCodeAgent, ChatMessage, ToolEvent } from './agent.js';
import {
  allowGlobalCommandPrefix,
  clearGlobalCommandApprovals,
  getApprovalPath,
  getGlobalApprovalPrefixes
} from './approvals.js';
import { readRecentAudit, getAuditPath } from './audit.js';
import { getConfigPath, readConfig } from './config.js';
import {
  getMemoryPath,
  getProjectMemoryPath,
  openMemoryFile,
  type MemoryScope,
  ensureMemoryFile
} from './memory.js';
import { loadMcpConfig, getMcpConfigPath, initMcpConfig } from './mcp.js';
import type { McpClientManager } from './mcp_client.js';
import { type AgentMode } from './modes.js';
import { getGlobalPolicyPath, getPolicyPath, writeDefaultGlobalPolicy, writeDefaultPolicy } from './policy.js';
import {
  setActiveSessionPlanRuntimeState,
  appendInputHistoryEntry,
  approveCommandForSession,
  approveCommandOnce,
  bindPlanToActiveSession,
  clearActiveSessionPlanBinding,
  clearSessionApprovals,
  getInputHistory,
  type InputHistoryEntry,
  listSessionApprovals,
  listSessions,
  loadActiveSession,
  loadSessionById,
  loadSessionToolEvents,
  renameActiveSession,
  rewindActiveSession,
  setActiveSessionPlanPhase,
  type SessionRecord,
  saveSessionMessages,
  saveSessionToolEvents,
  switchSession
} from './session.js';
import { runTriadReview } from './agents/index.js';
import { MultiAgentRuntime } from './agents_runtime.js';
import {
  createPlanArtifactsDetailed,
  ensureSolvingTaskConsistency,
  loadTaskSnapshot,
  MAX_TOP_LEVEL_TASKS,
  parseTaskOutcomeFromAssistantReply,
  updateCurrentTaskOutcome,
  type TaskStateSnapshot
} from './plan_mode_state.js';
import { capturePreTurnSnapshot, rollbackCode, type PreTurnSnapshot, type RollbackMode } from './rollback.js';

type Props = {
  agent: HappyCodeAgent;
  initialHistory?: ChatMessage[];
  onHistoryChange?: (messages: ChatMessage[]) => void;
  defaultMode?: AgentMode;
  enableAudit?: boolean;
  defaultModel?: string;
  configuredModel?: string;
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

type UserQuestionOption = {
  id: string;
  label: string;
  description?: string;
};

type UserQuestionPayload = {
  title: string;
  question: string;
  types: string[];
  options: UserQuestionOption[];
  defaultType?: string;
  defaultOptionId?: string;
  meta?: Record<string, unknown>;
};

type UserQuestionFocus = 'type' | 'option';

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
  { cmd: '/test [command]', complete: '/test', desc: 'Run tests via tools' },
  { cmd: '/fix', complete: '/fix', desc: 'Investigate and fix issues' },
  { cmd: '/theme', complete: '/theme ', desc: 'Get or set UI theme' },
  { cmd: '/model [name]', complete: '/model ', desc: 'Get or set model' },
  { cmd: '/permissions', complete: '/permissions', desc: 'Show tool permission config' },
  { cmd: '/permissions allow <tool>', complete: '/permissions allow ', desc: 'Allow specific tool' },
  { cmd: '/permissions deny <tool>', complete: '/permissions deny ', desc: 'Deny specific tool' },
  { cmd: '/permissions clear', complete: '/permissions clear', desc: 'Clear tool restrictions' },
  { cmd: '/resume', complete: '/resume', desc: 'Open session picker (↑/↓ + Enter)' },
  { cmd: '/rewind <n>', complete: '/rewind ', desc: 'Drop last N messages' },
  { cmd: '/rename <name>', complete: '/rename ', desc: 'Rename current session' },
  { cmd: '/export [path]', complete: '/export ', desc: 'Export transcript' },
  { cmd: '/context', complete: '/context', desc: 'Show context summary' },
  { cmd: '/stats', complete: '/stats', desc: 'Show local usage stats from audit log' },
  { cmd: '/usage', complete: '/usage', desc: 'Alias for /stats' },
  { cmd: '/copy', complete: '/copy', desc: 'Copy latest assistant response' },
  { cmd: '/debug', complete: '/debug', desc: 'Show debug info' },
  { cmd: '/doctor', complete: '/doctor', desc: 'Run environment checks' },
  { cmd: '/memory', complete: '/memory', desc: 'Open memory file picker' },
  { cmd: '/memory user|project', complete: '/memory ', desc: 'Open selected memory file' },
  { cmd: '/mcp', complete: '/mcp', desc: 'Show MCP config status' },
  { cmd: '/mcp init', complete: '/mcp init', desc: 'Create MCP config' },
  { cmd: '/agents [prompt]', complete: '/agents ', desc: 'Run multi-agent orchestration' },
  { cmd: '/audit', complete: '/audit', desc: 'Show recent audit logs' },
  { cmd: '/allow once <command>', complete: '/allow once ', desc: 'Approve exact shell command once' },
  { cmd: '/allow session <prefix>', complete: '/allow session ', desc: 'Approve shell prefix for session' },
  { cmd: '/allow global <prefix>', complete: '/allow global ', desc: 'Approve shell prefix globally' },
  { cmd: '/approvals', complete: '/approvals', desc: 'Show command approvals' },
  { cmd: '/approvals clear', complete: '/approvals clear', desc: 'Clear session + one-time approvals' },
  { cmd: '/approvals clear global', complete: '/approvals clear global', desc: 'Clear global command approvals' },
  { cmd: '/policy init', complete: '/policy init', desc: 'Create policy file' },
  { cmd: '/policy path', complete: '/policy path', desc: 'Show policy path' },
  { cmd: '/policy global init', complete: '/policy global init', desc: 'Create global policy file' },
  { cmd: '/policy global path', complete: '/policy global path', desc: 'Show global policy path' },
  { cmd: '/init', complete: '/init', desc: 'Show important file paths' },
  { cmd: '/clear', complete: '/clear', desc: 'Clear conversation' },
  { cmd: '/exit', complete: '/exit', desc: 'Quit' }
];

const CORE_COMMANDS_SET = new Set([
  '/help',
  '/new',
  '/test [command]',
  '/fix',
  '/model [name]',
  '/resume',
  '/clear',
  '/exit'
]);

const CORE_COMMANDS: CommandDef[] = COMMANDS.filter((item) => CORE_COMMANDS_SET.has(item.cmd));

const MODE_HELP_TEXT = [
  'Modes:',
  '  plan  Analysis and implementation planning',
  '  edit  Direct coding and code changes',
  '  auto  Adaptive mode selection',
  'Shortcut: Shift+Tab to cycle modes'
].join('\n');

function renderCommandHelp(commands: CommandDef[]): string {
  return commands.map((item) => `${item.cmd.padEnd(34, ' ')} ${item.desc}`).join('\n');
}

function buildHelpText(scope: 'core' | 'all'): string {
  const title = scope === 'all' ? 'All Commands:' : 'Core Commands:';
  const hint = scope === 'all' ? 'Tip: use /help <command> for details.' : 'Tip: use /help all to see advanced commands.';
  const source = scope === 'all' ? COMMANDS : CORE_COMMANDS;
  return [title, renderCommandHelp(source), '', hint, '', MODE_HELP_TEXT].join('\n');
}

function findCommandForHelp(query: string): CommandDef | undefined {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  const exact = COMMANDS.find((item) => item.cmd.toLowerCase() === normalized || item.complete.trim().toLowerCase() === normalized);
  if (exact) {
    return exact;
  }
  return COMMANDS.find((item) => item.cmd.toLowerCase().startsWith(normalized));
}

type ModeDisplay = {
  label: string;
  hint: string;
  color: 'yellow' | 'blue' | 'green';
};

const MODE_DISPLAY: Record<AgentMode, ModeDisplay> = {
  auto: {
    label: 'Auto',
    hint: 'Automatically chooses planning or execution',
    color: 'yellow'
  },
  edit: {
    label: 'Edit',
    hint: 'Directly implements changes in code',
    color: 'blue'
  },
  plan: {
    label: 'Plan',
    hint: 'Focuses on analysis and step-by-step planning',
    color: 'green'
  }
};

const MODE_CYCLE: AgentMode[] = ['plan', 'edit', 'auto'];
const MAX_RENDER_FLOW_ITEMS = 120;
const MAX_TOOL_EVENTS_STORE = 2000;
const MAX_PREVIEW_LINES = 5;
const MAX_PREVIEW_CHARS = 560;
const PLAN_PANEL_MAX_ITEMS = 8;

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function formatAbsoluteTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso || 'unknown';
  }
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const hours = pad2(date.getHours());
  const minutes = pad2(date.getMinutes());
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function formatRelativeTime(iso: string, now = Date.now()): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) {
    return 'unknown';
  }
  const diffSeconds = Math.floor((now - ts) / 1000);
  if (diffSeconds <= 30) {
    return 'just now';
  }
  if (diffSeconds < 3600) {
    return `${Math.floor(diffSeconds / 60)}m ago`;
  }
  if (diffSeconds < 86400) {
    return `${Math.floor(diffSeconds / 3600)}h ago`;
  }
  return `${Math.floor(diffSeconds / 86400)}d ago`;
}

function isShiftTabInput(inputKey: string, key: { tab?: boolean; shift?: boolean }): boolean {
  return (key.tab && key.shift) || inputKey === '\u001b[Z';
}

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
  const matched = CORE_COMMANDS.find((item) => item.complete.endsWith(' ') && input === item.complete);
  if (!matched) {
    return '';
  }
  return getCommandParamHint(matched);
}

function countUserTurns(messages: ChatMessage[]): number {
  return messages.filter((item) => item.role === 'user').length;
}

function parseMemoryScope(raw: string): MemoryScope | null {
  if (raw === 'user' || raw === 'project') {
    return raw;
  }
  return null;
}

type MemoryPickerItem = { scope: MemoryScope; label: string };

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

function isSubAgentLogMessage(message: ChatMessage): boolean {
  return message.role === 'assistant' && /^\[subagent:/i.test(message.content.trim());
}

function stripSubAgentMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter((item) => !isSubAgentLogMessage(item));
}

export function App({
  agent,
  initialHistory = [],
  onHistoryChange,
  defaultMode = 'auto',
  enableAudit = true,
  defaultModel,
  configuredModel,
  appVersion = '0.1.0',
  defaultRuntime,
  mcpManager
}: Props): React.JSX.Element {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const initialMode = defaultRuntime?.mode ?? defaultMode;
  const [terminalColumns, setTerminalColumns] = useState<number>(stdout.columns ?? 80);
  const [history, setHistory] = useState<ChatMessage[]>(initialHistory);
  const [input, setInput] = useState('');
  const [runtime, setRuntime] = useState<RuntimeOptions>({
    mode: initialMode,
    model: defaultRuntime?.model ?? defaultModel,
    fallbackModel: defaultRuntime?.fallbackModel,
    maxTurns: defaultRuntime?.maxTurns ?? 24,
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
  const [resumePickerOpen, setResumePickerOpen] = useState(false);
  const [resumeCandidates, setResumeCandidates] = useState<SessionRecord[]>([]);
  const [resumeCursor, setResumeCursor] = useState(0);
  const [pendingUserQuestion, setPendingUserQuestion] = useState<UserQuestionPayload | null>(null);
  const [questionFocus, setQuestionFocus] = useState<UserQuestionFocus>('option');
  const [selectedTypeIndex, setSelectedTypeIndex] = useState(0);
  const [selectedOptionIndex, setSelectedOptionIndex] = useState(0);
  const [memoryPickerOpen, setMemoryPickerOpen] = useState(false);
  const [memoryPickerCursor, setMemoryPickerCursor] = useState(0);
  const [taskSnapshot, setTaskSnapshot] = useState<TaskStateSnapshot | null>(null);
  const [rollbackArmedUntil, setRollbackArmedUntil] = useState<number | null>(null);
  const [inputHistory, setInputHistory] = useState<InputHistoryEntry[]>([]);
  const [historyBrowseActive, setHistoryBrowseActive] = useState(false);
  const [historyBrowseIndex, setHistoryBrowseIndex] = useState<number | null>(null);
  const [draftBeforeHistoryBrowse, setDraftBeforeHistoryBrowse] = useState('');
  const [rollbackHistoryPickerOpen, setRollbackHistoryPickerOpen] = useState(false);
  const [rollbackHistoryCursor, setRollbackHistoryCursor] = useState(0);
  const pendingQuestionResolveRef = useRef<((answer: Record<string, unknown>) => void) | null>(null);
  const toolSeqRef = useRef(0);
  const toolTurnRef = useRef(0);
  const toolEventsHydratedRef = useRef(false);
  const streamingBufferRef = useRef('');
  const streamingFlushTimerRef = useRef<NodeJS.Timeout | null>(null);
  const interruptControllerRef = useRef<AbortController | null>(null);
  const preTurnSnapshotRef = useRef<PreTurnSnapshot | null>(null);
  const snapshotByHistoryIdRef = useRef<Map<string, PreTurnSnapshot>>(new Map());

  const rollbackCandidates = useMemo(() => {
    return inputHistory.filter((item) => snapshotByHistoryIdRef.current.has(item.id));
  }, [inputHistory]);

  const visibleRollbackCandidates = useMemo(() => {
    return rollbackCandidates.slice(-20);
  }, [rollbackCandidates]);

  const themeStyle = THEME_STYLES[theme];
  const projectPath = useMemo(() => process.cwd(), []);
  const contentWidth = useMemo(() => Math.max(24, terminalColumns - 2), [terminalColumns]);
  const flowSeparator = useMemo(() => '─'.repeat(contentWidth), [contentWidth]);

  const shiftMode = useCallback(() => {
    setRuntime((prev) => {
      const currentIdx = MODE_CYCLE.indexOf(prev.mode);
      const nextMode = MODE_CYCLE[(currentIdx + 1 + MODE_CYCLE.length) % MODE_CYCLE.length] ?? MODE_CYCLE[0];
      return { ...prev, mode: nextMode };
    });
  }, []);

  const closeUserQuestion = useCallback(() => {
    setPendingUserQuestion(null);
    setQuestionFocus('option');
    setSelectedTypeIndex(0);
    setSelectedOptionIndex(0);
  }, []);

  const executeRollback = useCallback(
    (mode: RollbackMode, historyEntryId?: string) => {
      const snapshot = historyEntryId
        ? snapshotByHistoryIdRef.current.get(historyEntryId) ?? null
        : preTurnSnapshotRef.current;
      if (!snapshot) {
        if (historyEntryId) {
          const selected = inputHistory.find((item) => item.id === historyEntryId);
          if (selected) {
            setInput(selected.text);
            setInputKey((prev) => prev + 1);
            setError('No rollback snapshot for this history item. Restored input draft only.');
            return;
          }
        }
        setError('No rollback snapshot available.');
        return;
      }

      if (mode === 'keep') {
        setError('Rollback cancelled.');
        return;
      }

      setHistory(snapshot.history);
      onHistoryChange?.(snapshot.history);
      setToolEvents(snapshot.toolEvents as ToolTimelineEvent[]);
      toolSeqRef.current = (snapshot.toolEvents as ToolTimelineEvent[]).reduce(
        (max, item) => (item.seq > max ? item.seq : max),
        0
      );
      toolTurnRef.current = (snapshot.toolEvents as ToolTimelineEvent[]).reduce(
        (max, item) => (item.turn > max ? item.turn : max),
        0
      );
      setInputHistory(snapshot.inputHistoryBeforeTurn);
      setHistoryBrowseActive(false);
      setHistoryBrowseIndex(null);
      setDraftBeforeHistoryBrowse('');
      setSuggestionIndex(snapshot.suggestionIndexBeforeTurn);
      setInput(snapshot.inputBeforeTurn);
      setInputKey((prev) => prev + 1);
      setError('Rolled back dialogue to selected point.');

      if (mode === 'dialogue_only') {
        return;
      }

      const code = rollbackCode(snapshot);
      setError(code.ok ? `Rolled back dialogue + code. ${code.message}` : `Dialogue rolled back, code rollback failed: ${code.message}`);
    },
    [inputHistory, onHistoryChange]
  );

  const confirmUserQuestion = useCallback(() => {
    if (!pendingUserQuestion || !pendingQuestionResolveRef.current) {
      return;
    }

    const type = pendingUserQuestion.types[selectedTypeIndex] ?? pendingUserQuestion.types[0] ?? 'single_choice';
    const option = pendingUserQuestion.options[selectedOptionIndex] ?? pendingUserQuestion.options[0];
    const answer = {
      type,
      optionId: option?.id ?? '',
      optionLabel: option?.label ?? '',
      question: pendingUserQuestion.question,
      title: pendingUserQuestion.title,
      meta: pendingUserQuestion.meta ?? {}
    };

    const questionKind =
      typeof pendingUserQuestion.meta?.kind === 'string' ? pendingUserQuestion.meta.kind : undefined;

    if (pendingUserQuestion.title === 'Shell approval required') {
      const meta = (pendingUserQuestion.meta ?? {}) as Record<string, unknown>;
      const command = typeof meta.command === 'string' ? meta.command : '';
      const sessionPrefix = typeof meta.sessionPrefix === 'string' ? meta.sessionPrefix : '';

      if (answer.optionId === 'allow_once' && command) {
        approveCommandOnce(command, process.cwd());
      } else if (answer.optionId === 'allow_session') {
        const value = sessionPrefix || command;
        if (value) {
          approveCommandForSession(value, process.cwd());
        }
      } else if (answer.optionId === 'allow_global') {
        const value = sessionPrefix || command;
        if (value) {
          allowGlobalCommandPrefix(value);
        }
      }
    }

    const resolver = pendingQuestionResolveRef.current;
    pendingQuestionResolveRef.current = null;
    closeUserQuestion();

    if (questionKind === 'rollback_confirm' || pendingUserQuestion.title === 'Rollback code as well?') {
      const optionId = answer.optionId;
      const mode: RollbackMode =
        optionId === 'rollback_both' ? 'both' : optionId === 'rollback_dialogue' ? 'dialogue_only' : 'keep';
      const selectedId = typeof pendingUserQuestion.meta?.historyEntryId === 'string' ? pendingUserQuestion.meta.historyEntryId : undefined;
      executeRollback(mode, selectedId);
      resolver(answer);
      return;
    }

    resolver(answer);
  }, [closeUserQuestion, executeRollback, pendingUserQuestion, selectedOptionIndex, selectedTypeIndex]);

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
    const existingUserTurns = countUserTurns(history);
    const normalized = persisted.filter((item) => item.turn <= existingUserTurns);
    setToolEvents(normalized);
    if (normalized.length > 0) {
      const maxSeq = normalized.reduce((max, item) => (item.seq > max ? item.seq : max), 0);
      const maxTurn = normalized.reduce((max, item) => (item.turn > max ? item.turn : max), 0);
      toolSeqRef.current = maxSeq;
      toolTurnRef.current = maxTurn;
    }
    toolEventsHydratedRef.current = true;
  }, []);

  useEffect(() => {
    if (!toolEventsHydratedRef.current) {
      return;
    }
    const existingUserTurns = countUserTurns(history);
    setToolEvents((prev) => prev.filter((item) => item.turn <= existingUserTurns));
  }, [history]);

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

  const applySwitchedSession = useCallback(
    (switched: SessionRecord) => {
      setHistory(switched.messages);
      const switchedEvents = (switched.toolEvents ?? []) as ToolTimelineEvent[];
      setToolEvents(switchedEvents);
      toolSeqRef.current = switchedEvents.reduce((max, item) => (item.seq > max ? item.seq : max), 0);
      toolTurnRef.current = switchedEvents.reduce((max, item) => (item.turn > max ? item.turn : max), 0);
      onHistoryChange?.(switched.messages);
      setInputHistory(switched.inputHistory ?? []);
      setHistoryBrowseActive(false);
      setHistoryBrowseIndex(null);
      setDraftBeforeHistoryBrowse('');
    },
    [onHistoryChange]
  );

  const closeResumePicker = useCallback(() => {
    setResumePickerOpen(false);
    setResumeCandidates([]);
    setResumeCursor(0);
  }, []);

  const memoryPickerItems = useMemo<MemoryPickerItem[]>(
    () => [
      { scope: 'user', label: 'User Memory (Global)' },
      { scope: 'project', label: 'Project Memory (Current Project)' }
    ],
    []
  );

  const closeMemoryPicker = useCallback(() => {
    setMemoryPickerOpen(false);
    setMemoryPickerCursor(0);
  }, []);

  const openMemoryByScope = useCallback(
    async (scope: MemoryScope) => {
      setError(null);
      const result = await openMemoryFile(scope, process.cwd());
      if (!result.ok) {
        return;
      }
    },
    []
  );

  const refreshTaskSnapshot = useCallback(() => {
    const active = loadActiveSession(process.cwd());
    if (!active.activePlanId) {
      setTaskSnapshot(null);
      return;
    }
    const snapshot = loadTaskSnapshot(active.activePlanId);
    if (!snapshot) {
      setTaskSnapshot(null);
      return;
    }
    setTaskSnapshot(snapshot);
  }, []);

  useEffect(() => {
    refreshTaskSnapshot();
  }, [history, refreshTaskSnapshot]);

  useEffect(() => {
    setInputHistory(getInputHistory(process.cwd()));
  }, []);

  useEffect(() => {
    if (!rollbackArmedUntil) {
      return;
    }
    const timer = setTimeout(() => {
      setRollbackArmedUntil((current) => {
        if (!current || Date.now() >= current) {
          return null;
        }
        return current;
      });
    }, Math.max(0, rollbackArmedUntil - Date.now()));
    return () => clearTimeout(timer);
  }, [rollbackArmedUntil]);

  const confirmMemorySelection = useCallback(() => {
    const selected = memoryPickerItems[memoryPickerCursor];
    if (!selected) {
      return;
    }
    closeMemoryPicker();
    void openMemoryByScope(selected.scope);
  }, [closeMemoryPicker, memoryPickerCursor, memoryPickerItems, openMemoryByScope]);

  const confirmResumeSelection = useCallback(() => {
    const selected = resumeCandidates[resumeCursor];
    if (!selected) {
      return;
    }
    const switched = switchSession(selected.id, process.cwd());
    if (!switched) {
      setError(`Session not found: ${selected.id}`);
      closeResumePicker();
      return;
    }
    applySwitchedSession(switched);
    closeResumePicker();
    pushAssistant(`Resumed session: ${switched.name}`, setHistory, onHistoryChange);
  }, [applySwitchedSession, closeResumePicker, onHistoryChange, resumeCandidates, resumeCursor]);

  const inputSuggestions = useMemo(() => {
    const trimmed = input.trim();
    if (!trimmed.startsWith('/')) {
      return [] as InputSuggestion[];
    }

    const optionSuggestions = [
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
    const coreMatches = CORE_COMMANDS.filter((item) => item.cmd.toLowerCase().startsWith(needle));
    const advancedMatches = COMMANDS.filter(
      (item) => !CORE_COMMANDS_SET.has(item.cmd) && item.cmd.toLowerCase().startsWith(needle)
    );
    const commandsToShow = coreMatches.length > 0 || needle === '/' ? coreMatches : [...coreMatches, ...advancedMatches];
    return commandsToShow
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
    const now = Date.now();
    if (key.escape && !pendingUserQuestion && !rollbackHistoryPickerOpen && !resumePickerOpen && !memoryPickerOpen) {
      const armed = rollbackArmedUntil !== null && now <= rollbackArmedUntil;
      if (armed) {
        setRollbackArmedUntil(null);
        if (visibleRollbackCandidates.length === 0) {
          setError('No rollback points available.');
          return;
        }
        setRollbackHistoryPickerOpen(true);
        setRollbackHistoryCursor(visibleRollbackCandidates.length - 1);
        return;
      }

      if (loading && interruptControllerRef.current) {
        interruptControllerRef.current.abort();
      }
      setRollbackArmedUntil(now + 1200);
      setError(
        loading
          ? 'Interrupted. Press Esc again within 1.2s to open rollback list.'
          : 'Press Esc again within 1.2s to open rollback list.'
      );
      return;
    }

    if (rollbackHistoryPickerOpen) {
      if (key.escape) {
        setRollbackHistoryPickerOpen(false);
        return;
      }
      if (visibleRollbackCandidates.length === 0) {
        setRollbackHistoryPickerOpen(false);
        return;
      }
      if (key.upArrow) {
        setRollbackHistoryCursor((prev) => Math.max(0, prev - 1));
        return;
      }
      if (key.downArrow) {
        setRollbackHistoryCursor((prev) => Math.min(visibleRollbackCandidates.length - 1, prev + 1));
        return;
      }
      if (key.return) {
        const selected = visibleRollbackCandidates[rollbackHistoryCursor];
        if (!selected) {
          return;
        }
        setRollbackHistoryPickerOpen(false);
        setQuestionFocus('option');
        setSelectedTypeIndex(0);
        setSelectedOptionIndex(0);
        setPendingUserQuestion({
          title: 'Rollback code as well?',
          question: `Selected input: ${selected.text.slice(0, 80)}${selected.text.length > 80 ? '...' : ''}`,
          types: ['single_choice'],
          options: [
            { id: 'rollback_both', label: 'Rollback code + dialogue', description: 'Restore files and conversation.' },
            { id: 'rollback_dialogue', label: 'Rollback dialogue only', description: 'Keep code changes.' },
            { id: 'keep', label: 'Keep current state', description: 'Do not rollback.' }
          ],
          defaultType: 'single_choice',
          defaultOptionId: 'rollback_both',
          meta: { kind: 'rollback_confirm', historyEntryId: selected.id }
        });
        pendingQuestionResolveRef.current = () => {};
        return;
      }
      return;
    }

    if (pendingUserQuestion) {
      if (key.escape) {
        closeUserQuestion();
        setError(null);
        return;
      }

      if (key.tab) {
        setQuestionFocus((prev) => (prev === 'type' ? 'option' : 'type'));
        return;
      }

      if (questionFocus === 'type' && pendingUserQuestion.types.length > 0) {
        if (key.upArrow) {
          setSelectedTypeIndex((prev) => (prev - 1 + pendingUserQuestion.types.length) % pendingUserQuestion.types.length);
          return;
        }
        if (key.downArrow) {
          setSelectedTypeIndex((prev) => (prev + 1) % pendingUserQuestion.types.length);
          return;
        }
      }

      if (questionFocus === 'option' && pendingUserQuestion.options.length > 0) {
        if (key.upArrow) {
          setSelectedOptionIndex((prev) => (prev - 1 + pendingUserQuestion.options.length) % pendingUserQuestion.options.length);
          return;
        }
        if (key.downArrow) {
          setSelectedOptionIndex((prev) => (prev + 1) % pendingUserQuestion.options.length);
          return;
        }
      }

      if (key.return) {
        confirmUserQuestion();
        return;
      }

      return;
    }

    if (rollbackHistoryPickerOpen) {
      return;
    }

    if (resumePickerOpen) {
      if (key.escape) {
        closeResumePicker();
        setError(null);
        return;
      }

      if (resumeCandidates.length === 0) {
        return;
      }

      if (key.upArrow) {
        setResumeCursor((prev) => (prev - 1 + resumeCandidates.length) % resumeCandidates.length);
        return;
      }

      if (key.downArrow) {
        setResumeCursor((prev) => (prev + 1) % resumeCandidates.length);
        return;
      }
    }

    if (memoryPickerOpen) {
      if (key.escape) {
        closeMemoryPicker();
        setError(null);
        return;
      }
      if (memoryPickerItems.length === 0) {
        return;
      }
      if (key.upArrow) {
        setMemoryPickerCursor((prev) => (prev - 1 + memoryPickerItems.length) % memoryPickerItems.length);
        return;
      }
      if (key.downArrow) {
        setMemoryPickerCursor((prev) => (prev + 1) % memoryPickerItems.length);
        return;
      }
      if (key.return) {
        confirmMemorySelection();
        return;
      }
    }

    if (key.escape) {
      setInputAtEnd('');
      setError(null);
      return;
    }

    if (isShiftTabInput(inputKey, key)) {
      shiftMode();
      setError(null);
      return;
    }

    if (!loading && !pendingUserQuestion && !resumePickerOpen && !memoryPickerOpen && inputHistory.length > 0) {
      if (key.upArrow) {
        if (!historyBrowseActive) {
          setHistoryBrowseActive(true);
          setDraftBeforeHistoryBrowse(input);
          const index = inputHistory.length - 1;
          setHistoryBrowseIndex(index);
          setInputAtEnd(inputHistory[index]?.text ?? '');
          return;
        }
        const current = historyBrowseIndex ?? inputHistory.length;
        const next = Math.max(0, current - 1);
        setHistoryBrowseIndex(next);
        setInputAtEnd(inputHistory[next]?.text ?? '');
        return;
      }

      if (key.downArrow && historyBrowseActive) {
        const current = historyBrowseIndex ?? inputHistory.length - 1;
        const next = current + 1;
        if (next >= inputHistory.length) {
          setHistoryBrowseActive(false);
          setHistoryBrowseIndex(null);
          setInputAtEnd(draftBeforeHistoryBrowse);
          return;
        }
        setHistoryBrowseIndex(next);
        setInputAtEnd(inputHistory[next]?.text ?? '');
        return;
      }
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
      async (
        taskPrompt: string,
        modeOverride?: AgentMode,
        historyEntryIdOverride?: string
      ): Promise<string | null> => {
        const historyEntryId = historyEntryIdOverride ?? inputHistory[inputHistory.length - 1]?.id ?? '';
        preTurnSnapshotRef.current = capturePreTurnSnapshot({
          historyEntryId,
          cwd: process.cwd(),
          history,
          toolEvents: toolEvents as Array<Record<string, unknown>>,
          inputBeforeTurn: input,
          inputHistoryBeforeTurn: inputHistory,
          suggestionIndexBeforeTurn: suggestionIndex
        });
        if (historyEntryId && preTurnSnapshotRef.current) {
          snapshotByHistoryIdRef.current.set(historyEntryId, preTurnSnapshotRef.current);
        }
        const abortController = new AbortController();
        interruptControllerRef.current = abortController;
        setRollbackArmedUntil(null);
        const effectiveMode = modeOverride ?? runtime.mode;
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
      const nextHistory: ChatMessage[] = [...stripSubAgentMessages(history), userMessage];
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
              mode: effectiveMode,
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
                : undefined,
              abortSignal: abortController.signal,
              onUserQuestion: (payload) =>
                new Promise<Record<string, unknown>>((resolve) => {
                const parsed = {
                  title: typeof payload.title === 'string' ? payload.title : 'Need your decision',
                  question: typeof payload.question === 'string' ? payload.question : 'Please choose an option.',
                  types: Array.isArray(payload.types)
                    ? payload.types.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
                    : ['single_choice'],
                  options: Array.isArray(payload.options)
                    ? payload.options
                        .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
                        .map((item, index) => ({
                          id: typeof item.id === 'string' && item.id.trim() ? item.id : `option_${index + 1}`,
                          label: typeof item.label === 'string' && item.label.trim() ? item.label : `Option ${index + 1}`,
                          description: typeof item.description === 'string' ? item.description : ''
                        }))
                    : [
                        { id: 'option_1', label: 'Proceed with default', description: 'Use default path.' },
                        { id: 'option_2', label: 'Need clarification', description: 'Ask user for more detail.' }
                      ],
                  defaultType: typeof payload.defaultType === 'string' ? payload.defaultType : '',
                  defaultOptionId: typeof payload.defaultOptionId === 'string' ? payload.defaultOptionId : '',
                  meta:
                    payload.meta && typeof payload.meta === 'object'
                      ? (payload.meta as Record<string, unknown>)
                      : undefined
                };

                const typeIndex = Math.max(0, parsed.types.findIndex((item) => item === parsed.defaultType));
                const optionIndex = Math.max(0, parsed.options.findIndex((item) => item.id === parsed.defaultOptionId));

                setQuestionFocus('option');
                setSelectedTypeIndex(typeIndex);
                setSelectedOptionIndex(optionIndex);
                setPendingUserQuestion(parsed);
                pendingQuestionResolveRef.current = resolve;
              })
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

          const finalReply = reply;

          setHistory((prev) => {
            const assistantMessage: ChatMessage = { role: 'assistant', content: finalReply };
            const updated = [...prev, assistantMessage];
            onHistoryChange?.(updated);
            return updated;
        });

        if (effectiveMode === 'plan') {
          const active = loadActiveSession(process.cwd());
          const persisted = createPlanArtifactsDetailed({
            sessionId: active.id,
            planText: finalReply,
            sourcePrompt: taskPrompt
          });
          if (persisted.ok) {
            bindPlanToActiveSession(persisted.value.planId, persisted.value.planId, 'planning', process.cwd());
            setActiveSessionPlanRuntimeState(
              {
                planVersion: persisted.value.snapshot.planVersion,
                orchestratorStep: 'planning'
              },
              process.cwd()
            );
            setTaskSnapshot(persisted.value.snapshot);
          } else {
            pushAssistant(
              `Plan was not persisted: ${persisted.detail} Top-level markdown todos must be 3-${MAX_TOP_LEVEL_TASKS}.`,
              setHistory,
              onHistoryChange
            );
          }
        } else {
          const active = loadActiveSession(process.cwd());
          if (active.activePlanId && active.planSolvePhase === 'solving') {
            const parsed = parseTaskOutcomeFromAssistantReply(finalReply);
            if (parsed) {
              const updated = updateCurrentTaskOutcome(active.activePlanId, parsed.outcome, {
                note: parsed.note,
                source: 'assistant_reply'
              });
              if (updated) {
                if (updated.phase === 'completed') {
                  setActiveSessionPlanPhase('completed', process.cwd());
                }
                setActiveSessionPlanRuntimeState(
                  {
                    planVersion: updated.planVersion,
                    orchestratorStep: updated.orchestratorStep ?? 'tasking'
                  },
                  process.cwd()
                );
                setTaskSnapshot(updated);
              }
            } else {
              const healed = ensureSolvingTaskConsistency(active.activePlanId, 'turn_consistency');
              if (healed) {
                if (healed.phase === 'completed') {
                  setActiveSessionPlanPhase('completed', process.cwd());
                }
                setActiveSessionPlanRuntimeState(
                  {
                    planVersion: healed.planVersion,
                    orchestratorStep: healed.orchestratorStep ?? 'tasking'
                  },
                  process.cwd()
                );
                setTaskSnapshot(healed);
              }
            }
          }
        }

        if (streamingFlushTimerRef.current) {
          clearTimeout(streamingFlushTimerRef.current);
          streamingFlushTimerRef.current = null;
        }
        setStreaming(streamingBufferRef.current);
        setStreaming('');
        streamingBufferRef.current = '';
        return finalReply;
      } catch (err) {
        pendingQuestionResolveRef.current = null;
        closeUserQuestion();
        const message = err instanceof Error ? err.message : String(err);
        if (abortController.signal.aborted || /Interrupted by user\./i.test(message)) {
          pushAssistant('Interrupted by user.', setHistory, onHistoryChange);
        } else {
          setError(message);
        }
        return null;
      } finally {
        if (streamingFlushTimerRef.current) {
          clearTimeout(streamingFlushTimerRef.current);
          streamingFlushTimerRef.current = null;
        }
        setLoading(false);
        if (interruptControllerRef.current === abortController) {
          interruptControllerRef.current = null;
        }
      }
    },
    [agent, enableAudit, history, input, inputHistory, onHistoryChange, runtime, suggestionIndex, toolEvents]
  );

  const handleSlashCommand = useCallback(
    (content: string): boolean => {
      if (content === '/help') {
        pushAssistant(buildHelpText('core'), setHistory, onHistoryChange);
        return true;
      }

      if (content === '/help all') {
        pushAssistant(buildHelpText('all'), setHistory, onHistoryChange);
        return true;
      }

      if (content.startsWith('/help ')) {
        const query = content.replace('/help ', '').trim();
        const command = findCommandForHelp(query);
        if (!command) {
          pushAssistant(`Unknown command: ${query}\nUse /help for common commands, /help all for full list.`, setHistory, onHistoryChange);
          return true;
        }
        const detail = [
          `Command: ${command.cmd}`,
          `Description: ${command.desc}`,
          `Usage: ${command.cmd}`,
          command.complete.endsWith(' ')
            ? `Completion prefix: ${command.complete}`
            : 'Completion prefix: (none)'
        ].join('\n');
        pushAssistant(detail, setHistory, onHistoryChange);
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
          `active_session: ${active.id} (${active.name})`,
          `active_plan: ${active.activePlanId ?? '(none)'}`,
          `plan_phase: ${active.planSolvePhase ?? 'planning'}`,
          `task_progress: ${
            taskSnapshot
              ? `${taskSnapshot.progress.done}/${taskSnapshot.progress.total} (${taskSnapshot.progress.percent}%)`
              : '(none)'
          }`
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
          `memory_user_exists: ${fs.existsSync(getMemoryPath())}`,
          `memory_project_exists: ${fs.existsSync(getProjectMemoryPath(process.cwd()))}`,
          `audit_exists: ${fs.existsSync(getAuditPath())}`
        ].join('\n');
        pushAssistant(checks, setHistory, onHistoryChange);
        return true;
      }

      if (content === '/new') {
        clearActiveSessionPlanBinding(process.cwd());
        setTaskSnapshot(null);
        preTurnSnapshotRef.current = null;
        snapshotByHistoryIdRef.current.clear();
        setHistoryBrowseActive(false);
        setHistoryBrowseIndex(null);
        setDraftBeforeHistoryBrowse('');
        setRollbackHistoryPickerOpen(false);
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
          const compactedUserTurns = compacted.filter((item) => item.role === 'user').length;
          setToolEvents((prevEvents) => prevEvents.filter((item) => item.turn <= compactedUserTurns));
          onHistoryChange?.(compacted);
          return compacted;
        });
        pushAssistant('Compacted context to latest 6 messages.', setHistory, onHistoryChange);
        return true;
      }

      if (content === '/review') {
        void runAgentTask(
          'Please review the current repository changes. Use git_status and git_diff tools first, then provide: summary, potential bugs, security risks, and actionable fixes.',
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
          `global_policy: ${getGlobalPolicyPath()}`,
          `mcp: ${getMcpConfigPath(process.cwd())}`,
          `memory_user: ${getMemoryPath()}`,
          `memory_project: ${getProjectMemoryPath(process.cwd())}`,
          `audit: ${getAuditPath()}`,
          `approvals: ${getApprovalPath()}`
        ].join('\n');
        pushAssistant(info, setHistory, onHistoryChange);
        return true;
      }

      if (content === '/clear') {
        clearActiveSessionPlanBinding(process.cwd());
        setTaskSnapshot(null);
        preTurnSnapshotRef.current = null;
        snapshotByHistoryIdRef.current.clear();
        setHistoryBrowseActive(false);
        setHistoryBrowseIndex(null);
        setDraftBeforeHistoryBrowse('');
        setRollbackHistoryPickerOpen(false);
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
        setMemoryPickerOpen(true);
        setMemoryPickerCursor(0);
        setError(null);
        setInput('');
        return true;
      }

      if (content.startsWith('/memory ')) {
        const args = content.replace('/memory ', '').trim().split(/\s+/).filter(Boolean);
        const scope = parseMemoryScope((args[0] ?? '').toLowerCase());
        if (!scope) {
          pushAssistant('Usage:\n/memory\n/memory user\n/memory project', setHistory, onHistoryChange);
          return true;
        }
        ensureMemoryFile(scope, process.cwd());
        void openMemoryByScope(scope);
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
          const resultsRaw = await runTriadReview(
            agent,
            prompt,
            {
              cwd: process.cwd(),
              enableAudit,
              model: runtime.model,
              fallbackModel: runtime.fallbackModel,
              maxTurns: runtime.maxTurns,
              allowedTools: runtime.allowedTools,
              disallowedTools: runtime.disallowedTools,
              systemPrompt: runtime.systemPrompt,
              appendSystemPrompt: runtime.appendSystemPrompt
            },
            mcpManager
              ? {
                  mcpTools: await mcpManager.listTools(),
                  mcpCall: (fullName, args) => mcpManager.callTool(fullName, args)
                }
              : undefined
          );
          const results = resultsRaw.map((item) => ({
            name: item.name,
            mode: item.mode,
            output: item.output,
            io: {
              summary: item.summary,
              taskStateDelta: item.meta.taskStateDelta,
              replanDecision: item.meta.replanDecision
            }
          }));
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
        const sessions = listSessions(process.cwd());
        if (sessions.length === 0) {
          pushAssistant('No sessions available.', setHistory, onHistoryChange);
          return true;
        }
        setResumeCandidates(sessions);
        setResumeCursor(0);
        setResumePickerOpen(true);
        setError(null);
        setInput('');
        return true;
      }

      if (content.startsWith('/resume ')) {
        pushAssistant('Usage: /resume (no id needed). Pick one from the list.', setHistory, onHistoryChange);
        return true;
      }

      if (content.startsWith('/rewind ')) {
        const n = Number.parseInt(content.replace('/rewind ', '').trim(), 10);
        const rewound = rewindActiveSession(Number.isFinite(n) ? n : 1, process.cwd());
        setHistory(rewound.messages);
        setToolEvents((rewound.toolEvents ?? []) as ToolTimelineEvent[]);
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
        const session = listSessionApprovals(process.cwd());
        const global = getGlobalApprovalPrefixes();
        const source = loadSessionById(loadActiveSession(process.cwd()).id);
        const msg = [
          `Approvals path: ${getApprovalPath()}`,
          'One-time approvals:',
          ...(session.once.length ? session.once.map((s) => `- ${s}`) : ['- (none)']),
          'Session approvals:',
          ...(session.session.length ? session.session.map((s) => `- ${s}`) : ['- (none)']),
          'Global approvals:',
          ...(global.length ? global.map((s) => `- ${s}`) : ['- (none)']),
          source?.name ? `Active session: ${source.name} (${source.id})` : ''
        ]
          .filter(Boolean)
          .join('\n');
        pushAssistant(msg, setHistory, onHistoryChange);
        return true;
      }

      if (content === '/approvals clear global') {
        clearGlobalCommandApprovals();
        pushAssistant('Cleared global command approvals.', setHistory, onHistoryChange);
        return true;
      }

      if (content === '/approvals clear') {
        clearSessionApprovals(process.cwd());
        pushAssistant('Cleared one-time and session approvals.', setHistory, onHistoryChange);
        return true;
      }

      if (content.startsWith('/allow once ')) {
        const cmd = content.replace('/allow once ', '').trim();
        if (!cmd) {
          setError('Usage: /allow once <command>');
        } else {
          approveCommandOnce(cmd, process.cwd());
          pushAssistant(`Approved one-time command: ${cmd}`, setHistory, onHistoryChange);
        }
        return true;
      }

      if (content.startsWith('/allow session ')) {
        const prefix = content.replace('/allow session ', '').trim();
        if (!prefix) {
          setError('Usage: /allow session <command-prefix>');
        } else {
          approveCommandForSession(prefix, process.cwd());
          pushAssistant(`Approved session prefix: ${prefix}`, setHistory, onHistoryChange);
        }
        return true;
      }

      if (content.startsWith('/allow global ')) {
        const prefix = content.replace('/allow global ', '').trim();
        if (!prefix) {
          setError('Usage: /allow global <command-prefix>');
        } else {
          allowGlobalCommandPrefix(prefix);
          pushAssistant(`Approved global prefix: ${prefix}`, setHistory, onHistoryChange);
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

      if (content === '/policy global init') {
        const p = writeDefaultGlobalPolicy();
        pushAssistant(`Global policy initialized at: ${p}`, setHistory, onHistoryChange);
        return true;
      }

      if (content === '/policy global path') {
        const p = getGlobalPolicyPath();
        pushAssistant(`Global policy path: ${p}`, setHistory, onHistoryChange);
        return true;
      }

      return false;
    },
    [
      inputSuggestions,
      applySwitchedSession,
      closeResumePicker,
      enableAudit,
      history,
      inputHistory,
      loading,
      memoryPickerOpen,
      onHistoryChange,
      pendingUserQuestion,
      resumePickerOpen,
      runAgentTask,
      openMemoryByScope,
      rollbackHistoryPickerOpen,
      runtime,
      taskSnapshot
    ]
  );

  const submit = useCallback(async () => {
    if (pendingUserQuestion) {
      confirmUserQuestion();
      return;
    }

    if (resumePickerOpen) {
      confirmResumeSelection();
      return;
    }

    if (memoryPickerOpen) {
      confirmMemorySelection();
      return;
    }

    if (rollbackHistoryPickerOpen) {
      return;
    }

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
    let nextInputHistory = inputHistory;
    let historyEntryIdForTurn = '';
    if (content.trim()) {
      nextInputHistory = appendInputHistoryEntry(content, process.cwd());
      setInputHistory(nextInputHistory);
      historyEntryIdForTurn = nextInputHistory[nextInputHistory.length - 1]?.id ?? '';
    }
    setHistoryBrowseActive(false);
    setHistoryBrowseIndex(null);
    setDraftBeforeHistoryBrowse('');

    if (content.startsWith('/')) {
      const handled = handleSlashCommand(content);
      if (!handled) {
        pushAssistant(`Unknown command: ${content}\nUse /help`, setHistory, onHistoryChange);
      }
      return;
    }

    await runAgentTask(content, undefined, historyEntryIdForTurn);
  }, [
    inputSuggestions,
    draftBeforeHistoryBrowse,
    exit,
    handleSlashCommand,
    historyBrowseActive,
    historyBrowseIndex,
    input,
    inputHistory,
    loading,
    onHistoryChange,
    runAgentTask,
    confirmResumeSelection,
    confirmMemorySelection,
    confirmUserQuestion,
    setInputAtEnd,
    suggestionIndex,
    resumePickerOpen,
    memoryPickerOpen,
    rollbackHistoryPickerOpen,
    pendingUserQuestion
  ]);

  useEffect(() => {
    if (!loading) {
      setRollbackArmedUntil(null);
    }
  }, [loading]);

  const visibleResumeCandidates = useMemo(() => {
    if (!resumePickerOpen) {
      return [] as SessionRecord[];
    }
    const maxItems = 10;
    if (resumeCandidates.length <= maxItems) {
      return resumeCandidates;
    }
    const start = Math.max(0, Math.min(resumeCursor - Math.floor(maxItems / 2), resumeCandidates.length - maxItems));
    return resumeCandidates.slice(start, start + maxItems);
  }, [resumeCandidates, resumeCursor, resumePickerOpen]);

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

  const modeDisplay = MODE_DISPLAY[runtime.mode] ?? MODE_DISPLAY.auto;
  const sortedPlanItems = useMemo(() => {
    if (!taskSnapshot) {
      return [];
    }
    const order: Record<TaskStateSnapshot['items'][number]['status'], number> = {
      doing: 0,
      blocked: 1,
      todo: 2,
      done: 3
    };
    return [...taskSnapshot.items].sort((a, b) => {
      const left = order[a.status] ?? 9;
      const right = order[b.status] ?? 9;
      if (left !== right) {
        return left - right;
      }
      return a.id.localeCompare(b.id);
    });
  }, [taskSnapshot]);
  const visiblePlanItems = sortedPlanItems.slice(0, PLAN_PANEL_MAX_ITEMS);
  const hiddenPlanItems = Math.max(0, sortedPlanItems.length - visiblePlanItems.length);

  return (
    <Box flexDirection="column" padding={1}>
      <Box borderStyle="round" borderColor={themeStyle.titleColor} paddingX={1} flexDirection="column" width={contentWidth}>
        <Text color={themeStyle.titleColor}>:) HappyCode</Text>
        <Text color={themeStyle.metaColor}>Project: {projectPath}</Text>
        <Text color={themeStyle.metaColor}>Model: {configuredModel ?? '(not configured)'}</Text>
        <Box>
          <Text color={themeStyle.metaColor}>Mode: </Text>
          <Text color={modeDisplay.color}>{modeDisplay.label}</Text>
          <Text color={themeStyle.metaColor}> (Shift+Tab cycles)</Text>
        </Box>
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
              <Box paddingX={1} flexDirection="column">
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
                <Text color="gray">{toPreviewText(baseDetail, 10, 1200)}</Text>
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

      {taskSnapshot ? (
        <Box marginTop={1} flexDirection="column" width={contentWidth}>
          <Box>
            <Text color="gray">* </Text>
            <Text color="cyan">Updated Plan ({visiblePlanItems.length}/{taskSnapshot.items.length})</Text>
          </Box>
          {visiblePlanItems.map((item) => {
            const marker = item.status === 'done' ? '[x]' : '[ ]';
            const color = item.status === 'doing' ? 'cyan' : item.status === 'blocked' ? 'yellow' : 'gray';
            const suffix = item.status === 'blocked' ? ' (blocked)' : '';
            return (
              <Text key={item.id} color={color}>
                {'  '} {marker} {item.title}
                {suffix}
              </Text>
            );
          })}
          {hiddenPlanItems > 0 ? <Text color="gray">{`  ... ${hiddenPlanItems} more tasks.`}</Text> : null}
        </Box>
      ) : null}

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
        <Box>
          <Text color="green">{'> '}</Text>
          <TextInput key={inputKey} value={input} onChange={setInput} onSubmit={submit} />
          {inlineParamPlaceholder ? <Text color="gray">{inlineParamPlaceholder}</Text> : null}
        </Box>
        <Box marginTop={1}>
          <Text color="gray">Mode: </Text>
          <Text color={modeDisplay.color}>{modeDisplay.label}</Text>
          <Text color="gray"> - {modeDisplay.hint} (Shift+Tab to cycle)</Text>
        </Box>
        {historyBrowseActive ? (
          <Box>
            <Text color="gray">
              Input History: {(historyBrowseIndex ?? 0) + 1}/{inputHistory.length} (↑/↓ browse, Enter submit)
            </Text>
          </Box>
        ) : null}
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

      {pendingUserQuestion ? (
        <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} marginTop={1} width={contentWidth}>
          <Text color="yellow">User Question Required</Text>
          <Text>{pendingUserQuestion.title}</Text>
          <Text color="gray">{pendingUserQuestion.question}</Text>
          <Text color={questionFocus === 'type' ? 'cyan' : 'white'}>
            Types: {pendingUserQuestion.types.map((item, idx) => (idx === selectedTypeIndex ? `[${item}]` : item)).join('  ')}
          </Text>
          {pendingUserQuestion.options.map((item, idx) => (
            <Text key={item.id} color={questionFocus === 'option' && idx === selectedOptionIndex ? 'cyan' : 'white'}>
              {idx === selectedOptionIndex ? '>' : ' '} {item.label}
              {item.description ? ` - ${item.description}` : ''}
            </Text>
          ))}
          <Text color="gray">Tab switch focus, ↑/↓ choose, Enter confirm</Text>
        </Box>
      ) : null}

      {resumePickerOpen ? (
        <Box marginTop={1} flexDirection="column" width={contentWidth}>
          <Text color="white">Resume Sessions (↑/↓ choose, Enter confirm, Esc cancel)</Text>
          {visibleResumeCandidates.map((item) => {
            const selected = resumeCandidates[resumeCursor]?.id === item.id;
            const absoluteEditedAt = formatAbsoluteTime(item.updatedAt);
            const relativeEditedAt = formatRelativeTime(item.updatedAt);
            return (
              <Text key={item.id} color={selected ? 'cyan' : 'white'}>
                {selected ? '>' : ' '} {item.name} last:{absoluteEditedAt} ({relativeEditedAt}) msgs:{item.messages.length}
              </Text>
            );
          })}
        </Box>
      ) : null}

      {memoryPickerOpen ? (
        <Box marginTop={1} flexDirection="column" width={contentWidth}>
          <Text color="white">Memory Files (↑/↓ choose, Enter open, Esc cancel)</Text>
          {memoryPickerItems.map((item, idx) => {
            const selected = idx === memoryPickerCursor;
            return (
              <Text key={item.scope} color={selected ? 'cyan' : 'white'}>
                {selected ? '>' : ' '} {item.label}
              </Text>
            );
          })}
        </Box>
      ) : null}

      {rollbackHistoryPickerOpen ? (
        <Box marginTop={1} flexDirection="column" width={contentWidth}>
          <Text color="white">Rollback Points (↑/↓ choose, Enter confirm, Esc cancel)</Text>
          {visibleRollbackCandidates.map((item, idx) => {
            const selected = idx === rollbackHistoryCursor;
            const preview = item.text.replace(/\r\n/g, ' ').replace(/\n/g, ' ').slice(0, 90);
            return (
              <Text key={item.id} color={selected ? 'cyan' : 'white'}>
                {selected ? '>' : ' '} {preview}
                <Text color="gray"> ({item.createdAt})</Text>
              </Text>
            );
          })}
        </Box>
      ) : null}
    </Box>
  );
}

