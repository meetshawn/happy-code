export type AgentMode = 'plan' | 'edit' | 'auto';

export type ModePolicy = {
  allowWrite: boolean;
  allowExec: boolean;
};

export function getModePolicy(mode: AgentMode): ModePolicy {
  switch (mode) {
    case 'plan':
      return { allowWrite: false, allowExec: false };
    case 'edit':
      return { allowWrite: true, allowExec: true };
    case 'auto':
      return { allowWrite: true, allowExec: true };
    default:
      return { allowWrite: false, allowExec: false };
  }
}

export function getModePrompt(mode: AgentMode): string {
  switch (mode) {
    case 'plan':
      return [
        'Mode=plan.',
        'You must produce an explicit, ordered implementation plan before execution.',
        'Include goals, constraints, milestones, risks, validation strategy, and rollback/alternative options.',
        'If key details are missing or uncertain, call user_question to request a decision instead of guessing.',
        'You may inspect files, but do not modify files or run shell commands.'
      ].join(' ');
    case 'edit':
      return 'Mode=edit. You may inspect/edit project files and run shell commands when required. Shell commands remain subject to runtime safety policy and user approval prompts. If uncertain, call user_question for explicit user choice.';
    case 'auto':
      return 'Mode=auto. You may inspect/edit files and run shell commands when required. If uncertain, call user_question for explicit user choice.';
    default:
      return 'Mode=plan. Produce a clear implementation plan first.';
  }
}

export const SUPPORTED_MODES: AgentMode[] = ['plan', 'edit', 'auto'];
