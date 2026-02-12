type HappyCodeConfig = {
    baseUrl: string;
    apiKey: string;
    model: string;
};
declare function getConfigPath(): string;
declare function readConfig(): HappyCodeConfig | null;
declare function writeConfig(config: HappyCodeConfig): void;

type AgentMode = 'plan' | 'edit' | 'auto';
type ModePolicy = {
    allowWrite: boolean;
    allowExec: boolean;
};
declare function getModePolicy(mode: AgentMode): ModePolicy;
declare function getModePrompt(mode: AgentMode): string;
declare const SUPPORTED_MODES: AgentMode[];

type McpToolDescriptor = {
    server: string;
    name: string;
    fullName: string;
    description: string;
    inputSchema?: Record<string, unknown>;
};

type ChatMessage = {
    role: 'user' | 'assistant' | 'system';
    content: string;
};
type AgentOptions = {
    mode: AgentMode;
    cwd: string;
    maxTurns?: number;
    enableAudit?: boolean;
    model?: string;
    fallbackModel?: string;
    allowedTools?: string[];
    disallowedTools?: string[];
    systemPrompt?: string;
    appendSystemPrompt?: string;
    mcpTools?: McpToolDescriptor[];
    mcpCall?: (fullName: string, args: Record<string, unknown>) => Promise<string>;
    onUserQuestion?: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
};
type ToolEvent = {
    source: 'model' | 'runtime';
    phase: 'start' | 'end';
    name: string;
    args: Record<string, unknown>;
    ok?: boolean;
    preview?: string;
    questionPayload?: Record<string, unknown>;
};
declare class HappyCodeAgent {
    private client;
    private readonly model;
    constructor(cfg: HappyCodeConfig);
    chatStream(messages: ChatMessage[], options: AgentOptions, onDelta?: (chunk: string) => void, onToolEvent?: (event: ToolEvent) => void): Promise<string>;
}

type AuditRecord = {
    timestamp: string;
    tool: string;
    mode: string;
    ok: boolean;
    input: Record<string, unknown>;
    summary: string;
};
declare function getAuditPath(): string;
declare function readRecentAudit(limit?: number): AuditRecord[];

type ResolvedPolicy = {
    allowShellPrefixes: string[];
    denyShellPatterns: string[];
    protectedPaths: string[];
    policyPath: string;
};
declare function getPolicyPath(cwd: string): string;
declare function getGlobalPolicyPath(): string;
declare function loadPolicy(cwd: string): ResolvedPolicy;
declare function writeDefaultPolicy(cwd: string): string;
declare function writeDefaultGlobalPolicy(): string;

declare function getApprovalPath(): string;
declare function allowGlobalCommandPrefix(prefix: string): void;
declare function clearGlobalCommandApprovals(): void;
declare function isGloballyApprovedCommand(command: string): boolean;
declare function getGlobalApprovalPrefixes(): string[];

export { HappyCodeAgent, SUPPORTED_MODES, allowGlobalCommandPrefix, clearGlobalCommandApprovals, getApprovalPath, getAuditPath, getConfigPath, getGlobalApprovalPrefixes, getGlobalPolicyPath, getModePolicy, getModePrompt, getPolicyPath, isGloballyApprovedCommand, loadPolicy, readConfig, readRecentAudit, writeConfig, writeDefaultGlobalPolicy, writeDefaultPolicy };
