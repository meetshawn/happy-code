import type { ChatMessage } from './agent.js';
import type { HappyCodeAgent } from './agent.js';
import type { McpToolDescriptor } from './mcp_client.js';
import type { AgentMode } from './modes.js';
import { runIsolatedAgentTurn } from './agents/agent_runner.js';
import type { TaskStateDelta } from './agents/agent_types.js';
import type { ReplanDecision } from './plan_runtime.js';
import { parseTaskOutcomeFromAssistantReply } from './plan_mode_state.js';
import { parseReplanDecision } from './plan_runtime.js';

export type SubAgentTask = {
  name: string;
  mode: AgentMode;
  prompt: string;
};

export type SubAgentRole = 'planner' | 'tasker' | 'replanner' | 'reviewer' | 'coder';

export type SubAgentIo = {
  summary: string;
  taskStateDelta?: TaskStateDelta;
  replanDecision?: ReplanDecision;
};

export type SubAgentResult = {
  name: string;
  mode: AgentMode;
  output: string;
  io: SubAgentIo;
};

export type SubAgentContext = {
  cwd: string;
  enableAudit: boolean;
  maxTurns?: number;
  model?: string;
  fallbackModel?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  systemPrompt?: string;
  appendSystemPrompt?: string;
  mcpTools?: McpToolDescriptor[];
  mcpCall?: (fullName: string, args: Record<string, unknown>) => Promise<string>;
  onUserQuestion?: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
  abortSignal?: AbortSignal;
  onDelta?: (chunk: string) => void;
  onToolEvent?: Parameters<HappyCodeAgent['chatStream']>[3];
};

export class MultiAgentRuntime {
  constructor(private readonly agent: HappyCodeAgent) {}

  async runSubAgentTurn(
    task: SubAgentTask,
    role: SubAgentRole,
    context: SubAgentContext,
    baseMessages: ChatMessage[] = []
  ): Promise<SubAgentResult> {
    const result = await runIsolatedAgentTurn(
      this.agent,
      {
        role,
        name: task.name,
        mode: task.mode,
        prompt: task.prompt,
        baseMessages
      },
      {
        cwd: context.cwd,
        enableAudit: context.enableAudit,
        model: context.model,
        fallbackModel: context.fallbackModel,
        maxTurns: context.maxTurns,
        allowedTools: context.allowedTools,
        disallowedTools: context.disallowedTools,
        systemPrompt: context.systemPrompt,
        appendSystemPrompt: context.appendSystemPrompt
      },
      {
        mcpTools: context.mcpTools,
        mcpCall: context.mcpCall,
        onUserQuestion: context.onUserQuestion,
        abortSignal: context.abortSignal,
        onDelta: context.onDelta,
        onToolEvent: context.onToolEvent
      }
    );

    return {
      name: task.name,
      mode: task.mode,
      output: result.output,
      io: {
        summary: result.summary,
        taskStateDelta:
          result.meta.taskStateDelta ?? (role === 'tasker' ? parseTaskOutcomeFromAssistantReply(result.output) ?? undefined : undefined),
        replanDecision:
          result.meta.replanDecision ?? (role === 'replanner' ? (parseReplanDecision(result.output) as ReplanDecision) : undefined)
      }
    };
  }

  async runTasks(
    baseMessages: ChatMessage[],
    tasks: SubAgentTask[],
    context: { cwd: string; enableAudit: boolean; maxTurns?: number }
  ): Promise<SubAgentResult[]> {
    const outputs: SubAgentResult[] = [];
    for (const task of tasks) {
      const result = await this.runSubAgentTurn(
        task,
        task.name as SubAgentRole,
        {
          cwd: context.cwd,
          enableAudit: context.enableAudit,
          maxTurns: context.maxTurns
        },
        baseMessages
      );
      outputs.push(result);
    }
    return outputs;
  }

  static formatResults(results: SubAgentResult[]): string {
    return results
      .map((item) => `# Agent: ${item.name} (${item.mode})\n${item.output}`)
      .join('\n\n');
  }
}
