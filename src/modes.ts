export type AgentMode = 'ask' | 'plan' | 'edit' | 'auto';

export type ModePolicy = {
  allowWrite: boolean;
  allowExec: boolean;
};

export function getModePolicy(mode: AgentMode): ModePolicy {
  switch (mode) {
    case 'ask':
      return { allowWrite: false, allowExec: false };
    case 'plan':
      return { allowWrite: false, allowExec: false };
    case 'edit':
      return { allowWrite: true, allowExec: false };
    case 'auto':
      return { allowWrite: true, allowExec: true };
    default:
      return { allowWrite: false, allowExec: false };
  }
}

export function getModePrompt(mode: AgentMode): string {
  switch (mode) {
    case 'ask':
      return 'Mode=ask. Answer coding questions, inspect files, do not modify files, do not run shell commands.';
    case 'plan':
      return 'Mode=plan. First produce an explicit implementation plan. You may inspect files, but do not modify files or run shell commands.';
    case 'edit':
      return 'Mode=edit. You may inspect and edit project files to complete tasks. Do not run shell commands.';
    case 'auto':
      return 'Mode=auto. You may inspect/edit files and run safe shell commands when required.';
    default:
      return 'Mode=ask. Read-only coding assistant behavior.';
  }
}

export const SUPPORTED_MODES: AgentMode[] = ['ask', 'plan', 'edit', 'auto'];

