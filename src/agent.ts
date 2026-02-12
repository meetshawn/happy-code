import OpenAI from 'openai';
import type { HappyCodeConfig } from './config.js';
import { getModePrompt, type AgentMode } from './modes.js';
import { TOOL_SCHEMA, runTool, USER_QUESTION_PREFIX, type ToolCall } from './tools.js';
import type { McpToolDescriptor } from './mcp_client.js';

export type ChatMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

export type AgentOptions = {
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

export type ToolEvent = {
  source: 'model' | 'runtime';
  phase: 'start' | 'end';
  name: string;
  args: Record<string, unknown>;
  ok?: boolean;
  preview?: string;
  questionPayload?: Record<string, unknown>;
};

const BASE_PROMPT =
  'You are HappyCode, a practical coding assistant. Prefer using tools for codebase-grounded answers. Keep responses concise, explicit, and actionable.';

function parseToolArgs(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function toOpenAIMessages(
  messages: ChatMessage[],
  mode: AgentMode,
  systemPrompt?: string,
  appendSystemPrompt?: string
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const merged = [
    BASE_PROMPT,
    systemPrompt ?? '',
    getModePrompt(mode),
    appendSystemPrompt ?? ''
  ]
    .map((item) => item.trim())
    .filter(Boolean)
    .join('\n\n');

  return [{ role: 'system', content: merged }, ...messages];
}

function withMcpTools(mcpTools?: McpToolDescriptor[]) {
  const extra = (mcpTools ?? []).map((item) => ({
    type: 'function' as const,
    function: {
      name: item.fullName,
      description: item.description || `MCP tool ${item.server}/${item.name}`,
      parameters:
        item.inputSchema ?? {
          type: 'object',
          properties: {}
        }
    }
  }));
  return [...TOOL_SCHEMA, ...extra];
}

function filterTools(
  tools: Array<{
    type: 'function';
    function: { name: string; description: string; parameters: Record<string, unknown> };
  }>,
  allowedTools?: string[],
  disallowedTools?: string[]
) {
  const allow = new Set((allowedTools ?? []).map((item) => item.trim()).filter(Boolean));
  const deny = new Set((disallowedTools ?? []).map((item) => item.trim()).filter(Boolean));

  return tools.filter((item) => {
    const name = item.function.name;
    if (allow.size > 0 && !allow.has(name)) {
      return false;
    }
    if (deny.has(name)) {
      return false;
    }
    return true;
  });
}

export class HappyCodeAgent {
  private client: OpenAI;
  private readonly model: string;

  constructor(cfg: HappyCodeConfig) {
    this.client = new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl });
    this.model = cfg.model;
  }

  async chatStream(
    messages: ChatMessage[],
    options: AgentOptions,
    onDelta?: (chunk: string) => void,
    onToolEvent?: (event: ToolEvent) => void
  ): Promise<string> {
    const maxTurns = options.maxTurns ?? 8;
    const running = toOpenAIMessages(
      messages,
      options.mode,
      options.systemPrompt,
      options.appendSystemPrompt
    );

    const mergedTools = withMcpTools(options.mcpTools);
    const tools = filterTools(mergedTools, options.allowedTools, options.disallowedTools);

    const model = options.model ?? this.model;
    const fallbackModel = options.fallbackModel;

    const createCompletion = async (
      completionMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]
    ) => {
      try {
        return await this.client.chat.completions.create({
          model,
          messages: completionMessages,
          tools: tools as unknown as OpenAI.Chat.Completions.ChatCompletionTool[],
          tool_choice: 'auto'
        });
      } catch (err) {
        if (!fallbackModel) {
          throw err;
        }
        return await this.client.chat.completions.create({
          model: fallbackModel,
          messages: completionMessages,
          tools: tools as unknown as OpenAI.Chat.Completions.ChatCompletionTool[],
          tool_choice: 'auto'
        });
      }
    };

    for (let turn = 0; turn < maxTurns; turn += 1) {
      const completion = await createCompletion(running);

      const message = completion.choices[0]?.message;
      if (!message) {
        return 'No response.';
      }

      if (!message.tool_calls || message.tool_calls.length === 0) {
        const content = message.content ?? 'No content.';
        onDelta?.(content);
        return content;
      }

      running.push({
        role: 'assistant',
        content: message.content,
        tool_calls: message.tool_calls
      });

      for (const toolCall of message.tool_calls) {
        if (toolCall.type !== 'function') {
          continue;
        }

        const toolName = toolCall.function.name;
        const toolArgs = parseToolArgs(toolCall.function.arguments);

        onToolEvent?.({
          source: 'model',
          phase: 'start',
          name: toolName,
          args: toolArgs
        });

        let result = '';
        if (toolName.startsWith('mcp__')) {
          if (!options.mcpCall) {
            result = 'MCP call unavailable in current runtime.';
          } else {
            try {
              result = await options.mcpCall(toolName, toolArgs);
            } catch (err) {
              result = `Tool error: ${err instanceof Error ? err.message : String(err)}`;
            }
          }
        } else {
          result = await runTool(
            {
              name: toolName as ToolCall['name'],
              args: toolArgs
            },
            {
              mode: options.mode,
              cwd: options.cwd,
              enableAudit: options.enableAudit ?? true
            }
          );
        }

        let questionPayload: Record<string, unknown> | undefined;
        if (toolName === 'user_question' && result.startsWith(USER_QUESTION_PREFIX)) {
          const raw = result.slice(USER_QUESTION_PREFIX.length);
          try {
            questionPayload = JSON.parse(raw) as Record<string, unknown>;
          } catch {
            questionPayload = undefined;
          }

          if (questionPayload && options.onUserQuestion) {
            try {
              const answer = await options.onUserQuestion(questionPayload);
              result = JSON.stringify(
                {
                  kind: 'user_question_answer',
                  answer
                },
                null,
                2
              );
            } catch (err) {
              result = `Tool error: ${err instanceof Error ? err.message : String(err)}`;
            }
          } else if (questionPayload) {
            result = JSON.stringify(
              {
                kind: 'user_question_required',
                message: 'User decision required in interactive mode.',
                question: questionPayload
              },
              null,
              2
            );
          }
        }

        onToolEvent?.({
          source: 'model',
          phase: 'end',
          name: toolName,
          args: toolArgs,
          ok: !result.startsWith('Denied') && !result.startsWith('Tool error'),
          preview: result.slice(0, 180),
          questionPayload
        });

        running.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: result
        });
      }
    }

    return 'Stopped after max tool turns. Please refine your request.';
  }
}
