import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  applyReplanArtifacts,
  createPlanArtifacts,
  createPlanArtifactsDetailed,
  enterSolvingPhase,
  updateCurrentTaskOutcome
} from '../src/plan_mode_state.js';

const TEST_HOME = path.join(process.cwd(), '.tmp-test-home');

function withFakeHome<T>(fn: () => T): T {
  const original = os.homedir;
  (os as unknown as { homedir: () => string }).homedir = () => TEST_HOME;
  try {
    return fn();
  } finally {
    (os as unknown as { homedir: () => string }).homedir = original;
  }
}

test('plan/task/replan state flow', async () => {
  fs.rmSync(TEST_HOME, { recursive: true, force: true });
  fs.mkdirSync(TEST_HOME, { recursive: true });

  withFakeHome(() => {
    const created = createPlanArtifacts({
      sessionId: 'session_test',
      planText: ['- [ ] task one', '- [ ] task two', '- [ ] task three'].join('\n'),
      sourcePrompt: 'integration test'
    });
    assert.ok(created);
    if (!created) {
      return;
    }

    const solving = enterSolvingPhase(created.planId, 'test');
    assert.ok(solving);
    assert.equal(solving?.phase, 'solving');

    const updated = updateCurrentTaskOutcome(created.planId, 'done', {
      note: 'done by test',
      source: 'test'
    });
    assert.ok(updated);
    assert.ok((updated?.progress.done ?? 0) >= 1);

    const replanned = applyReplanArtifacts({
      planId: created.planId,
      planText: ['- [ ] task one', '- [ ] task two', '- [ ] task four'].join('\n'),
      reason: 'integration drift',
      source: 'test'
    });
    assert.ok(replanned);
    assert.ok((replanned?.planVersion ?? 0) >= 2);
  });

  fs.rmSync(TEST_HOME, { recursive: true, force: true });
});

test('createPlanArtifactsDetailed rejects non-checklist markdown', () => {
  fs.rmSync(TEST_HOME, { recursive: true, force: true });
  fs.mkdirSync(TEST_HOME, { recursive: true });
  withFakeHome(() => {
    const created = createPlanArtifactsDetailed({
      sessionId: 'session_test',
      planText: ['- overview', '- implementation', '- tests'].join('\n'),
      sourcePrompt: 'invalid format'
    });
    assert.equal(created.ok, false);
    if (!created.ok) {
      assert.equal(created.error, 'invalid_todo_format');
    }
  });
  fs.rmSync(TEST_HOME, { recursive: true, force: true });
});

test('createPlanArtifactsDetailed rejects too many top-level tasks', () => {
  fs.rmSync(TEST_HOME, { recursive: true, force: true });
  fs.mkdirSync(TEST_HOME, { recursive: true });
  withFakeHome(() => {
    const lines = Array.from({ length: 9 }, (_, i) => `- [ ] task ${i + 1}`).join('\n');
    const created = createPlanArtifactsDetailed({
      sessionId: 'session_test',
      planText: lines,
      sourcePrompt: 'too many tasks'
    });
    assert.equal(created.ok, false);
    if (!created.ok) {
      assert.equal(created.error, 'too_many_tasks');
    }
  });
  fs.rmSync(TEST_HOME, { recursive: true, force: true });
});

test('applyReplanArtifacts ignores invalid NEW_PLAN format', () => {
  fs.rmSync(TEST_HOME, { recursive: true, force: true });
  fs.mkdirSync(TEST_HOME, { recursive: true });
  withFakeHome(() => {
    const created = createPlanArtifacts({
      sessionId: 'session_test',
      planText: ['- [ ] task one', '- [ ] task two', '- [ ] task three'].join('\n'),
      sourcePrompt: 'integration test'
    });
    assert.ok(created);
    if (!created) {
      return;
    }
    const replanned = applyReplanArtifacts({
      planId: created.planId,
      planText: ['- [ ] a', '- [ ] b'].join('\n'),
      reason: 'bad replan',
      source: 'test'
    });
    assert.ok(replanned);
    assert.equal(replanned?.planVersion, created.snapshot.planVersion);
    assert.equal(replanned?.items.length, created.snapshot.items.length);
  });
  fs.rmSync(TEST_HOME, { recursive: true, force: true });
});
