import type { ChatMessage } from '../agent.js';
import type { AgentMode } from '../modes.js';
import type { ReplanDecision } from '../plan_runtime.js';

export type AgentRole = 'planner' | 'tasker' | 'replanner' | 'reviewer' | 'coder';

export type AgentExecutionContext = {
  cwd: string;
  enableAudit: boolean;
  maxTurns?: number;
  model?: string;
  fallbackModel?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  systemPrompt?: string;
  appendSystemPrompt?: string;
};

export type AgentTurnRequest = {
  role: AgentRole;
  name?: string;
  mode: AgentMode;
  prompt: string;
  baseMessages?: ChatMessage[];
};

export type TaskStateDelta = {
  outcome: 'done' | 'blocked' | 'doing';
  note?: string;
};

export type AgentMeta = {
  taskStateDelta?: TaskStateDelta;
  replanDecision?: ReplanDecision;
  parseError?: string;
};

export type AgentResult<TMeta extends AgentMeta = AgentMeta> = {
  role: AgentRole;
  name: string;
  mode: AgentMode;
  prompt: string;
  output: string;
  summary: string;
  meta: TMeta;
};

