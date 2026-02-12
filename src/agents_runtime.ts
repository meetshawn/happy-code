import type { ChatMessage } from './agent.js';
import type { HappyCodeAgent } from './agent.js';
import type { AgentMode } from './modes.js';

export type SubAgentTask = {
  name: string;
  mode: AgentMode;
  prompt: string;
};

export type SubAgentResult = {
  name: string;
  mode: AgentMode;
  output: string;
};

export class MultiAgentRuntime {
  constructor(private readonly agent: HappyCodeAgent) {}

  async runTasks(
    baseMessages: ChatMessage[],
    tasks: SubAgentTask[],
    context: { cwd: string; enableAudit: boolean; maxTurns?: number }
  ): Promise<SubAgentResult[]> {
    const outputs: SubAgentResult[] = [];
    for (const task of tasks) {
      const result = await this.agent.chatStream(
        [...baseMessages, { role: 'user', content: task.prompt }],
        {
          mode: task.mode,
          cwd: context.cwd,
          enableAudit: context.enableAudit,
          maxTurns: context.maxTurns ?? 6
        }
      );
      outputs.push({
        name: task.name,
        mode: task.mode,
        output: result
      });
    }
    return outputs;
  }

  static formatResults(results: SubAgentResult[]): string {
    return results
      .map((item) => `# Agent: ${item.name} (${item.mode})\n${item.output}`)
      .join('\n\n');
  }
}

