import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { McpConfig } from './mcp.js';

type JsonRpcRequest = {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

type Pending = {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
};

type ServerState = {
  name: string;
  proc: ChildProcessWithoutNullStreams;
  nextId: number;
  buffer: string;
  pending: Map<number, Pending>;
};

export type McpToolDescriptor = {
  server: string;
  name: string;
  fullName: string;
  description: string;
  inputSchema?: Record<string, unknown>;
};

export class McpClientManager {
  private servers = new Map<string, ServerState>();

  async ensureServers(config: McpConfig): Promise<void> {
    for (const server of config.servers) {
      if (this.servers.has(server.name)) {
        continue;
      }
      const proc = spawn(server.command, server.args ?? [], {
        stdio: 'pipe',
        shell: process.platform === 'win32'
      });

      const state: ServerState = {
        name: server.name,
        proc,
        nextId: 1,
        buffer: '',
        pending: new Map()
      };

      proc.stdout.setEncoding('utf8');
      proc.stdout.on('data', (chunk: string) => {
        this.handleStdout(state, chunk);
      });

      proc.stderr.setEncoding('utf8');
      proc.stderr.on('data', () => {
      });

      proc.on('exit', () => {
        for (const [, pending] of state.pending) {
          pending.reject(new Error(`MCP server exited: ${state.name}`));
        }
        state.pending.clear();
        this.servers.delete(state.name);
      });

      this.servers.set(server.name, state);
      await this.initializeServer(state);
    }
  }

  private handleStdout(state: ServerState, chunk: string): void {
    state.buffer += chunk;
    while (true) {
      const idx = state.buffer.indexOf('\n');
      if (idx < 0) {
        break;
      }
      const line = state.buffer.slice(0, idx).trim();
      state.buffer = state.buffer.slice(idx + 1);
      if (!line) {
        continue;
      }

      try {
        const msg = JSON.parse(line) as JsonRpcResponse;
        if (typeof msg.id !== 'number') {
          continue;
        }
        const pending = state.pending.get(msg.id);
        if (!pending) {
          continue;
        }
        state.pending.delete(msg.id);
        if (msg.error) {
          pending.reject(new Error(msg.error.message));
        } else {
          pending.resolve(msg.result);
        }
      } catch {
        continue;
      }
    }
  }

  private call(state: ServerState, method: string, params?: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = state.nextId++;
      const payload: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };
      state.pending.set(id, { resolve, reject });
      state.proc.stdin.write(`${JSON.stringify(payload)}\n`, 'utf8');
    });
  }

  private async initializeServer(state: ServerState): Promise<void> {
    await this.call(state, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'happycode', version: '0.1.0' }
    });
    await this.call(state, 'notifications/initialized');
  }

  async listTools(): Promise<McpToolDescriptor[]> {
    const results: McpToolDescriptor[] = [];
    for (const [, state] of this.servers) {
      try {
        const raw = (await this.call(state, 'tools/list')) as {
          tools?: Array<{
            name: string;
            description?: string;
            inputSchema?: Record<string, unknown>;
          }>;
        };
        const tools = raw?.tools ?? [];
        for (const tool of tools) {
          results.push({
            server: state.name,
            name: tool.name,
            fullName: `mcp__${state.name}__${tool.name}`,
            description: tool.description ?? '',
            inputSchema: tool.inputSchema
          });
        }
      } catch {
        continue;
      }
    }
    return results;
  }

  async callTool(fullName: string, args: Record<string, unknown>): Promise<string> {
    const matched = /^mcp__([^_]+(?:_[^_]+)*)__(.+)$/.exec(fullName);
    if (!matched) {
      throw new Error(`Invalid MCP tool name: ${fullName}`);
    }

    const serverName = matched[1];
    const toolName = matched[2];
    const state = this.servers.get(serverName);
    if (!state) {
      throw new Error(`MCP server not connected: ${serverName}`);
    }

    const result = await this.call(state, 'tools/call', {
      name: toolName,
      arguments: args
    });
    return JSON.stringify(result, null, 2);
  }

  async shutdown(): Promise<void> {
    for (const [, state] of this.servers) {
      state.proc.kill();
    }
    this.servers.clear();
  }
}

