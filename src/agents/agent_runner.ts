import type { ChatMessage, HappyCodeAgent, ToolEvent } from '../agent.js';
import type { McpToolDescriptor } from '../mcp_client.js';
import { buildRuntimeMemoryPrompt } from '../memory.js';
import {
  type AgentExecutionContext,
  type AgentMeta,
  type AgentResult,
  type AgentRole,
  type AgentTurnRequest
} from './agent_types.js';

function summarizeOutput(raw: string): string {
  const firstNonEmpty = raw
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return firstNonEmpty ? firstNonEmpty.slice(0, 220) : '(empty output)';
}

export type AgentRunnerOptions = {
  mcpTools?: McpToolDescriptor[];
  mcpCall?: (fullName: string, args: Record<string, unknown>) => Promise<string>;
  onUserQuestion?: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
  abortSignal?: AbortSignal;
  onDelta?: (chunk: string) => void;
  onToolEvent?: (event: ToolEvent) => void;
};

export async function runIsolatedAgentTurn(
  agent: HappyCodeAgent,
  request: AgentTurnRequest,
  context: AgentExecutionContext,
  options?: AgentRunnerOptions
): Promise<AgentResult> {
  const baseMessages: ChatMessage[] = [...(request.baseMessages ?? [])];
  const output = await agent.chatStream(
    [...baseMessages, { role: 'user', content: request.prompt }],
    {
      mode: request.mode,
      cwd: context.cwd,
      enableAudit: context.enableAudit,
      model: context.model,
      fallbackModel: context.fallbackModel,
      maxTurns: context.maxTurns ?? 12,
      allowedTools: context.allowedTools,
      disallowedTools: context.disallowedTools,
      systemPrompt: context.systemPrompt,
      appendSystemPrompt: [context.appendSystemPrompt ?? '', buildRuntimeMemoryPrompt(context.cwd)]
        .filter(Boolean)
        .join('\n\n'),
      mcpTools: options?.mcpTools,
      mcpCall: options?.mcpCall,
      onUserQuestion: options?.onUserQuestion,
      abortSignal: options?.abortSignal
    },
    options?.onDelta,
    options?.onToolEvent
  );

  return {
    role: request.role,
    name: request.name ?? request.role,
    mode: request.mode,
    prompt: request.prompt,
    output,
    summary: summarizeOutput(output),
    meta: {} as AgentMeta
  };
}

export function asNamedResult<TMeta extends AgentMeta>(
  result: AgentResult,
  role: AgentRole,
  name: string,
  meta: TMeta
): AgentResult<TMeta> {
  return {
    ...result,
    role,
    name,
    meta
  };
}

