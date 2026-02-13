import type { HappyCodeAgent } from '../agent.js';
import { parseTaskOutcomeFromAssistantReply, type TaskStateSnapshot } from '../plan_mode_state.js';
import { buildTaskAgentPrompt } from '../plan_runtime.js';
import type { AgentExecutionContext, AgentResult, TaskStateDelta } from './agent_types.js';
import { asNamedResult, type AgentRunnerOptions, runIsolatedAgentTurn } from './agent_runner.js';

type TaskAgentMeta = {
  taskStateDelta?: TaskStateDelta;
  parseError?: string;
};

export async function runTaskAgent(
  agent: HappyCodeAgent,
  snapshot: TaskStateSnapshot,
  mode: 'edit' | 'auto' | 'plan',
  context: AgentExecutionContext,
  options?: AgentRunnerOptions
): Promise<AgentResult<TaskAgentMeta>> {
  const result = await runIsolatedAgentTurn(
    agent,
    {
      role: 'tasker',
      name: 'tasker',
      mode,
      prompt: buildTaskAgentPrompt(snapshot)
    },
    context,
    options
  );

  const parsed = parseTaskOutcomeFromAssistantReply(result.output);
  const meta: TaskAgentMeta = parsed
    ? { taskStateDelta: parsed }
    : { parseError: 'missing_task_state_control_line' };
  return asNamedResult(result, 'tasker', 'tasker', meta);
}
