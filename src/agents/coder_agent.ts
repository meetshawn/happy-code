import type { HappyCodeAgent } from '../agent.js';
import type { AgentExecutionContext, AgentResult } from './agent_types.js';
import { asNamedResult, type AgentRunnerOptions, runIsolatedAgentTurn } from './agent_runner.js';

const CODER_PROMPT = 'Provide concrete code-level changes to implement the request.';

export async function runCoderAgent(
  agent: HappyCodeAgent,
  context: AgentExecutionContext,
  basePrompt?: string,
  options?: AgentRunnerOptions
): Promise<AgentResult> {
  const prompt = basePrompt ? `${basePrompt}\n\n${CODER_PROMPT}` : CODER_PROMPT;
  const result = await runIsolatedAgentTurn(
    agent,
    {
      role: 'coder',
      name: 'coder',
      mode: 'edit',
      prompt
    },
    context,
    options
  );
  return asNamedResult(result, 'coder', 'coder', {});
}
