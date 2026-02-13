import type { TaskStateSnapshot } from './plan_mode_state.js';

export type ReplanDecision = {
  decision: 'apply' | 'skip';
  reason: string;
  planText?: string;
  raw: string;
  parseError?: 'missing_decision' | 'missing_reason';
};

function stripFence(text: string): string {
  return text.replace(/^```(?:markdown|md|text)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

export function buildPlannerPrompt(userPrompt: string): string {
  return [
    'You are plan-agent. Produce an executable implementation plan only.',
    'Output only a top-level markdown todo checklist in this exact format: "- [ ] <task>".',
    'Top-level tasks must be 3-8 items, one-line, implementation-oriented, and coarse-grained.',
    'Do not output numbered lists, nested bullets, sections, commentary, or code fences.',
    'If scope is complex, keep top-level tasks coarse and let task-agent split/execute details later.',
    'Do not implement. Do not run commands. Do not write files.',
    `User goal:\n${userPrompt}`
  ].join('\n\n');
}

export function buildTaskAgentPrompt(snapshot: TaskStateSnapshot): string {
  const current =
    snapshot.items.find((item) => item.id === snapshot.currentTaskId) ?? snapshot.items.find((item) => item.status === 'todo');
  const currentTaskText = current ? current.title : 'Pick the highest-priority todo task.';
  return [
    'You are task-agent. Solve exactly one current task in this turn.',
    'Make concrete progress for that task only.',
    `Current task: ${currentTaskText}`,
    `Plan summary:\nplan_id=${snapshot.planId} version=${snapshot.planVersion} phase=${snapshot.phase} progress=${snapshot.progress.done}/${snapshot.progress.total}`,
    'At the end, append TASK_STATE: done|blocked|doing and optional TASK_NOTE: <short note>.'
  ].join('\n\n');
}

export function buildReplanPrompt(snapshot: TaskStateSnapshot, taskReply: string): string {
  return [
    'You are replan-agent. Evaluate if replanning is needed after the last task-agent turn.',
    'Return strict format:',
    'REPLAN_DECISION: apply|skip',
    'REPLAN_REASON: <one short sentence>',
    'If apply, also include NEW_PLAN: then only top-level markdown todos in "- [ ] <task>" format.',
    'NEW_PLAN must contain 3-8 tasks. Keep tasks coarse-grained and implementation-oriented.',
    'Do not include nested bullets, numbered lists, extra sections, or fences in NEW_PLAN.',
    `Current snapshot:\nplan_id=${snapshot.planId}\nversion=${snapshot.planVersion}\nphase=${snapshot.phase}\nprogress=${snapshot.progress.done}/${snapshot.progress.total}\nblocked=${snapshot.blockedCount}`,
    `Last task-agent reply:\n${taskReply}`
  ].join('\n\n');
}

export function parseReplanDecision(reply: string): ReplanDecision {
  const normalized = reply.replace(/\r\n/g, '\n');
  const decisionMatch = normalized.match(/^REPLAN_DECISION:\s*(apply|skip)\s*$/im);
  const reasonMatch = normalized.match(/^REPLAN_REASON:\s*(.+)\s*$/im);
  const newPlanMatch = normalized.match(/NEW_PLAN:\s*([\s\S]*)$/im);

  const decision = (decisionMatch?.[1]?.toLowerCase() ?? 'skip') as 'apply' | 'skip';
  const reason = reasonMatch?.[1]?.trim() || 'No significant drift detected.';
  const planText = newPlanMatch ? stripFence(newPlanMatch[1] ?? '') : undefined;
  const parseError = !decisionMatch ? 'missing_decision' : !reasonMatch ? 'missing_reason' : undefined;

  return {
    decision,
    reason,
    planText: planText && planText.length > 0 ? planText : undefined,
    raw: reply,
    parseError
  };
}
