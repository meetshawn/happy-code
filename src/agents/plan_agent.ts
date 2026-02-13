import type { HappyCodeAgent } from '../agent.js';
import { buildPlannerPrompt } from '../plan_runtime.js';
import type { AgentExecutionContext, AgentResult } from './agent_types.js';
import { asNamedResult, type AgentRunnerOptions, runIsolatedAgentTurn } from './agent_runner.js';

export async function runPlanAgent(
  agent: HappyCodeAgent,
  userGoal: string,
  context: AgentExecutionContext,
  options?: AgentRunnerOptions
): Promise<AgentResult> {
  const result = await runIsolatedAgentTurn(
    agent,
    {
      role: 'planner',
      name: 'planner',
      mode: 'plan',
      prompt: buildPlannerPrompt(userGoal)
    },
    context,
    options
  );

  return asNamedResult(result, 'planner', 'planner', {});
}

