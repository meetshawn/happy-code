import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlannerPrompt, buildReplanPrompt, parseReplanDecision } from '../src/plan_runtime.js';
import type { TaskStateSnapshot } from '../src/plan_mode_state.js';

function createSnapshot(): TaskStateSnapshot {
  const now = new Date().toISOString();
  return {
    planId: 'plan_test',
    sessionId: 'session_test',
    phase: 'solving',
    planVersion: 1,
    items: [{ id: 'task_1', title: 'ship', status: 'doing', updatedAt: now }],
    progress: { done: 0, total: 1, percent: 0 },
    currentTaskId: 'task_1',
    blockedCount: 0,
    stats: { total: 1, todo: 0, doing: 1, done: 0, blocked: 0 },
    createdAt: now,
    updatedAt: now
  };
}

test('parseReplanDecision parses strict apply format', () => {
  const parsed = parseReplanDecision([
    'REPLAN_DECISION: apply',
    'REPLAN_REASON: New dependency discovered',
    'NEW_PLAN:',
    '- [ ] update api',
    '- [ ] add test'
  ].join('\n'));

  assert.equal(parsed.decision, 'apply');
  assert.equal(parsed.reason, 'New dependency discovered');
  assert.ok(parsed.planText?.includes('update api'));
  assert.equal(parsed.parseError, undefined);
});

test('parseReplanDecision marks missing fields', () => {
  const parsed = parseReplanDecision('just some free-form text');
  assert.equal(parsed.decision, 'skip');
  assert.equal(parsed.parseError, 'missing_decision');
});

test('buildPlannerPrompt enforces strict top-level todo constraints', () => {
  const prompt = buildPlannerPrompt('implement feature');
  assert.ok(prompt.includes('"- [ ] <task>"'));
  assert.ok(prompt.includes('3-8'));
  assert.ok(prompt.includes('No nested bullets'));
});

test('buildReplanPrompt enforces strict NEW_PLAN constraints', () => {
  const prompt = buildReplanPrompt(createSnapshot(), 'task reply');
  assert.ok(prompt.includes('NEW_PLAN'));
  assert.ok(prompt.includes('"- [ ] <task>"'));
  assert.ok(prompt.includes('3-8'));
});
