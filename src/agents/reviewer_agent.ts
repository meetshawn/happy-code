import type { HappyCodeAgent } from '../agent.js';
import type { AgentExecutionContext, AgentResult } from './agent_types.js';
import { asNamedResult, type AgentRunnerOptions, runIsolatedAgentTurn } from './agent_runner.js';

const REVIEWER_PROMPT = 'Review the proposed approach and list potential issues.';

export async function runReviewerAgent(
  agent: HappyCodeAgent,
  context: AgentExecutionContext,
  basePrompt?: string,
  options?: AgentRunnerOptions
): Promise<AgentResult> {
  const prompt = basePrompt ? `${basePrompt}\n\n${REVIEWER_PROMPT}` : REVIEWER_PROMPT;
  const result = await runIsolatedAgentTurn(
    agent,
    {
      role: 'reviewer',
      name: 'reviewer',
      mode: 'plan',
      prompt
    },
    context,
    options
  );
  return asNamedResult(result, 'reviewer', 'reviewer', {});
}
