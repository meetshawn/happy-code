import test from 'node:test';
import assert from 'node:assert/strict';
import type { HappyCodeAgent } from '../../src/agent.js';
import { runTaskAgent } from '../../src/agents/task_agent.js';
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
    planVersion: 1,
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

test('runTaskAgent parses TASK_STATE and TASK_NOTE', async () => {
  const agent = createFakeAgent('Did work\nTASK_STATE: done\nTASK_NOTE: implemented core');
  const result = await runTaskAgent(
    agent,
    createSnapshot(),
    'edit',
    {
      cwd: process.cwd(),
      enableAudit: false,
      maxTurns: 2
    }
  );

  assert.equal(result.role, 'tasker');
  assert.equal(result.meta.taskStateDelta?.outcome, 'done');
  assert.equal(result.meta.taskStateDelta?.note, 'implemented core');
  assert.equal(result.meta.parseError, undefined);
});

test('runTaskAgent marks parseError when TASK_STATE missing', async () => {
  const agent = createFakeAgent('Did work but forgot controls');
  const result = await runTaskAgent(
    agent,
    createSnapshot(),
    'edit',
    {
      cwd: process.cwd(),
      enableAudit: false,
      maxTurns: 2
    }
  );

  assert.equal(result.meta.taskStateDelta, undefined);
  assert.equal(result.meta.parseError, 'missing_task_state_control_line');
});

