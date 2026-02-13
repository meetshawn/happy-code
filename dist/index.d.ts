type HappyCodeConfig = {
    baseUrl: string;
    apiKey: string;
    model: string;
    maxTurns?: number;
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
    abortSignal?: AbortSignal;
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

type PlanSolvePhase = 'planning' | 'solving' | 'completed' | 'paused';
type TaskStatus = 'todo' | 'doing' | 'done' | 'blocked';
type TaskItem = {
    id: string;
    title: string;
    status: TaskStatus;
    notes?: string;
    attempts?: number;
    startedAt?: string;
    completedAt?: string;
    blockedReason?: string;
    updatedAt: string;
};
type TaskStateSnapshot = {
    planId: string;
    sessionId: string;
    phase: PlanSolvePhase;
    planVersion: number;
    lastReplanReason?: string;
    orchestratorStep?: 'planning' | 'tasking' | 'replanning';
    items: TaskItem[];
    progress: {
        done: number;
        total: number;
        percent: number;
    };
    currentTaskId?: string;
    lastUpdatedTaskId?: string;
    blockedCount: number;
    stats: {
        total: number;
        todo: number;
        doing: number;
        done: number;
        blocked: number;
    };
    createdAt: string;
    updatedAt: string;
};

type ReplanDecision = {
    decision: 'apply' | 'skip';
    reason: string;
    planText?: string;
    raw: string;
    parseError?: 'missing_decision' | 'missing_reason';
};

type AgentRole = 'planner' | 'tasker' | 'replanner' | 'reviewer' | 'coder';
type AgentExecutionContext = {
    cwd: string;
    enableAudit: boolean;
    maxTurns?: number;
    model?: string;
    fallbackModel?: string;
    allowedTools?: string[];
    disallowedTools?: string[];
    systemPrompt?: string;
    appendSystemPrompt?: string;
};
type AgentTurnRequest = {
    role: AgentRole;
    name?: string;
    mode: AgentMode;
    prompt: string;
    baseMessages?: ChatMessage[];
};
type TaskStateDelta = {
    outcome: 'done' | 'blocked' | 'doing';
    note?: string;
};
type AgentMeta = {
    taskStateDelta?: TaskStateDelta;
    replanDecision?: ReplanDecision;
    parseError?: string;
};
type AgentResult<TMeta extends AgentMeta = AgentMeta> = {
    role: AgentRole;
    name: string;
    mode: AgentMode;
    prompt: string;
    output: string;
    summary: string;
    meta: TMeta;
};

type AgentRunnerOptions = {
    mcpTools?: McpToolDescriptor[];
    mcpCall?: (fullName: string, args: Record<string, unknown>) => Promise<string>;
    onUserQuestion?: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
    abortSignal?: AbortSignal;
    onDelta?: (chunk: string) => void;
    onToolEvent?: (event: ToolEvent) => void;
};
declare function runIsolatedAgentTurn(agent: HappyCodeAgent, request: AgentTurnRequest, context: AgentExecutionContext, options?: AgentRunnerOptions): Promise<AgentResult>;

declare function runPlanAgent(agent: HappyCodeAgent, userGoal: string, context: AgentExecutionContext, options?: AgentRunnerOptions): Promise<AgentResult>;

type TaskAgentMeta = {
    taskStateDelta?: TaskStateDelta;
    parseError?: string;
};
declare function runTaskAgent(agent: HappyCodeAgent, snapshot: TaskStateSnapshot, mode: 'edit' | 'auto' | 'plan', context: AgentExecutionContext, options?: AgentRunnerOptions): Promise<AgentResult<TaskAgentMeta>>;

declare function runReviewerAgent(agent: HappyCodeAgent, context: AgentExecutionContext, basePrompt?: string, options?: AgentRunnerOptions): Promise<AgentResult>;

declare function runCoderAgent(agent: HappyCodeAgent, context: AgentExecutionContext, basePrompt?: string, options?: AgentRunnerOptions): Promise<AgentResult>;

declare function runTriadReview(agent: HappyCodeAgent, basePrompt: string, context: AgentExecutionContext, options?: AgentRunnerOptions): Promise<AgentResult[]>;

export { HappyCodeAgent, SUPPORTED_MODES, allowGlobalCommandPrefix, clearGlobalCommandApprovals, getApprovalPath, getAuditPath, getConfigPath, getGlobalApprovalPrefixes, getGlobalPolicyPath, getModePolicy, getModePrompt, getPolicyPath, isGloballyApprovedCommand, loadPolicy, readConfig, readRecentAudit, runCoderAgent, runIsolatedAgentTurn, runPlanAgent, runReviewerAgent, runTaskAgent, runTriadReview, writeConfig, writeDefaultGlobalPolicy, writeDefaultPolicy };
