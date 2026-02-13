import type { HappyCodeAgent } from '../agent.js';
import {
  applyReplanArtifacts,
  createPlanArtifactsDetailed,
  ensureSolvingTaskConsistency,
  enterSolvingPhase,
  loadTaskSnapshot,
  type PlanParseError,
  recordTaskEvent,
  updateCurrentTaskOutcome,
  type TaskStateSnapshot
} from '../plan_mode_state.js';
import type { AgentExecutionContext, AgentResult } from './agent_types.js';
import { type AgentRunnerOptions } from './agent_runner.js';
import { runCoderAgent } from './coder_agent.js';
import { runPlanAgent } from './plan_agent.js';
import { runReplanAgent } from './replan_agent.js';
import { runReviewerAgent } from './reviewer_agent.js';
import { runTaskAgent } from './task_agent.js';

const PLAN_RETRY_LIMIT = 2;

function buildPlannerRetryGoal(userGoal: string, error: PlanParseError, detail: string): string {
  const correction =
    error === 'too_many_tasks'
      ? 'Your previous output had too many top-level todos. Merge/simplify and keep exactly 3-8 top-level tasks.'
      : error === 'too_few_tasks'
        ? 'Your previous output had too few top-level todos. Expand to 3-8 top-level tasks.'
        : 'Your previous output was not strict markdown todos.';
  return [
    userGoal,
    '',
    'Rewrite the plan and follow these hard constraints:',
    correction,
    '- Output only top-level markdown todo lines in format: - [ ] <task>',
    '- No nested bullets, no numbered lists, no extra sections',
    '- Keep tasks coarse-grained; detailed execution belongs to task-agent',
    `Validation failure: ${detail}`
  ].join('\n');
}

export type PlanPhaseResult = {
  planner: AgentResult;
  snapshot: TaskStateSnapshot;
};

export type SolveStepResult = {
  task: AgentResult;
  snapshotAfterTask: TaskStateSnapshot | null;
  replan: AgentResult | null;
  snapshotAfterReplan: TaskStateSnapshot | null;
};

export async function runPlanPhase(
  agent: HappyCodeAgent,
  userGoal: string,
  context: AgentExecutionContext,
  sessionId: string,
  options?: AgentRunnerOptions
): Promise<PlanPhaseResult | null> {
  let prompt = userGoal;
  for (let attempt = 0; attempt <= PLAN_RETRY_LIMIT; attempt += 1) {
    const planner = await runPlanAgent(agent, prompt, context, options);
    const persisted = createPlanArtifactsDetailed({
      sessionId,
      planText: planner.output,
      sourcePrompt: userGoal
    });
    if (persisted.ok) {
      return {
        planner,
        snapshot: persisted.value.snapshot
      };
    }
    if (attempt === PLAN_RETRY_LIMIT) {
      return null;
    }
    prompt = buildPlannerRetryGoal(userGoal, persisted.error, persisted.detail);
  }
  return null;
}

export async function runSolveStep(
  agent: HappyCodeAgent,
  planId: string,
  mode: 'edit' | 'auto' | 'plan',
  context: AgentExecutionContext,
  options?: AgentRunnerOptions
): Promise<SolveStepResult | null> {
  const solving = enterSolvingPhase(planId, 'orchestrator_solve');
  if (!solving) {
    return null;
  }

  recordTaskEvent(planId, {
    eventType: 'task_agent_turn_started',
    source: 'orchestrator',
    taskId: solving.currentTaskId
  });

  const task = await runTaskAgent(agent, solving, mode, context, options);
  let snapshotAfterTask: TaskStateSnapshot | null;
  if (task.meta.taskStateDelta) {
    snapshotAfterTask = updateCurrentTaskOutcome(planId, task.meta.taskStateDelta.outcome, {
      note: task.meta.taskStateDelta.note,
      source: 'orchestrator_task'
    });
  } else {
    snapshotAfterTask = ensureSolvingTaskConsistency(planId, 'orchestrator_self_heal');
  }

  recordTaskEvent(planId, {
    eventType: 'task_agent_turn_finished',
    source: 'orchestrator',
    taskId: snapshotAfterTask?.lastUpdatedTaskId,
    note: task.summary
  });

  if (!snapshotAfterTask) {
    return {
      task,
      snapshotAfterTask,
      replan: null,
      snapshotAfterReplan: null
    };
  }

  recordTaskEvent(planId, {
    eventType: 'replan_requested',
    source: 'orchestrator',
    note: 'evaluate after task turn'
  });

  const replan = await runReplanAgent(agent, snapshotAfterTask, task.output, context, options);
  if (replan.meta.decision !== 'apply' || !replan.meta.planText) {
    recordTaskEvent(planId, {
      eventType: 'replan_skipped',
      source: 'orchestrator',
      note: replan.meta.reason
    });
    return {
      task,
      snapshotAfterTask,
      replan,
      snapshotAfterReplan: loadTaskSnapshot(planId)
    };
  }

  const applied = applyReplanArtifacts({
    planId,
    planText: replan.meta.planText,
    reason: replan.meta.reason,
    source: 'orchestrator'
  });

  return {
    task,
    snapshotAfterTask,
    replan,
    snapshotAfterReplan: applied
  };
}

export async function runTriadReview(
  agent: HappyCodeAgent,
  basePrompt: string,
  context: AgentExecutionContext,
  options?: AgentRunnerOptions
): Promise<AgentResult[]> {
  const planner = await runPlanAgent(agent, basePrompt, context, options);
  const coder = await runCoderAgent(agent, context, basePrompt, {
    ...options,
    onDelta: undefined,
    onToolEvent: undefined,
    onUserQuestion: options?.onUserQuestion
  });
  const reviewer = await runReviewerAgent(agent, context, basePrompt, {
    ...options,
    onDelta: undefined,
    onToolEvent: undefined,
    onUserQuestion: options?.onUserQuestion
  });
  return [planner, coder, reviewer];
}
