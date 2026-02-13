import test from 'node:test';
import assert from 'node:assert/strict';
import type { HappyCodeAgent } from '../../src/agent.js';
import { runPlanAgent } from '../../src/agents/plan_agent.js';

function createFakeAgent(output: string): HappyCodeAgent {
  return {
    chatStream: async () => output
  } as unknown as HappyCodeAgent;
}

test('runPlanAgent returns planner result with summary', async () => {
  const output = ['- [ ] task one', '- [ ] task two', '- [ ] task three'].join('\n');
  const agent = createFakeAgent(output);

  const result = await runPlanAgent(
    agent,
    'build feature X',
    {
      cwd: process.cwd(),
      enableAudit: false,
      maxTurns: 2
    }
  );

  assert.equal(result.role, 'planner');
  assert.equal(result.mode, 'plan');
  assert.equal(result.output, output);
  assert.ok(result.summary.includes('task one'));
});

