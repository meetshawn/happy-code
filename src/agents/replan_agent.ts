import type { HappyCodeAgent } from '../agent.js';
import type { TaskStateSnapshot } from '../plan_mode_state.js';
import { buildReplanPrompt, parseReplanDecision } from '../plan_runtime.js';
import type { AgentExecutionContext, AgentResult } from './agent_types.js';
import { asNamedResult, type AgentRunnerOptions, runIsolatedAgentTurn } from './agent_runner.js';

type ReplanMeta = {
  decision: 'apply' | 'skip';
  reason: string;
  planText?: string;
  parseError?: string;
};

export async function runReplanAgent(
  agent: HappyCodeAgent,
  snapshot: TaskStateSnapshot,
  taskReply: string,
  context: AgentExecutionContext,
  options?: AgentRunnerOptions
): Promise<AgentResult<ReplanMeta>> {
  const result = await runIsolatedAgentTurn(
    agent,
    {
      role: 'replanner',
      name: 'replanner',
      mode: 'plan',
      prompt: buildReplanPrompt(snapshot, taskReply)
    },
    context,
    options
  );

  const parsed = parseReplanDecision(result.output);
  return asNamedResult(result, 'replanner', 'replanner', {
    decision: parsed.decision,
    reason: parsed.reason,
    planText: parsed.planText,
    parseError: parsed.parseError
  });
}

