import test from 'node:test';
import assert from 'node:assert/strict';
import type { HappyCodeAgent } from '../../src/agent.js';
import { runReplanAgent } from '../../src/agents/replan_agent.js';
import type { TaskStateSnapshot } from '../../src/plan_mode_state.js';

function createFakeAgent(output: string): HappyCodeAgent {
  return {
    chatStream: async () => output
  } as unknown as HappyCodeAgent;
}

function createSnapshot(): TaskStateSnapshot {
  return {
    planId: 'plan_test',
    sessionId: 'session_test',
    phase: 'solving',
    planVersion: 2,
    items: [
      {
        id: 'task_1',
        title: 'implement feature',
        status: 'doing',
        updatedAt: new Date().toISOString()
      }
    ],
    progress: { done: 0, total: 1, percent: 0 },
    currentTaskId: 'task_1',
    blockedCount: 0,
    stats: { total: 1, todo: 0, doing: 1, done: 0, blocked: 0 },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

test('runReplanAgent parses apply decision and plan', async () => {
  const agent = createFakeAgent([
    'REPLAN_DECISION: apply',
    'REPLAN_REASON: Scope changed',
    'NEW_PLAN:',
    '- [ ] task one',
    '- [ ] task two'
  ].join('\n'));

  const result = await runReplanAgent(
    agent,
    createSnapshot(),
    'task reply',
    {
      cwd: process.cwd(),
      enableAudit: false,
      maxTurns: 2
    }
  );

  assert.equal(result.meta.decision, 'apply');
  assert.equal(result.meta.reason, 'Scope changed');
  assert.ok(result.meta.planText?.includes('task one'));
  assert.equal(result.meta.parseError, undefined);
});

test('runReplanAgent reports parseError when control lines missing', async () => {
  const agent = createFakeAgent('No strict control lines here');
  const result = await runReplanAgent(
    agent,
    createSnapshot(),
    'task reply',
    {
      cwd: process.cwd(),
      enableAudit: false,
      maxTurns: 2
    }
  );

  assert.equal(result.meta.decision, 'skip');
  assert.equal(result.meta.parseError, 'missing_decision');
});

