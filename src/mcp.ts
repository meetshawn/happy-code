import fs from 'node:fs';
import path from 'node:path';

const MCP_CONFIG_NAME = '.happycode-mcp.json';

export type McpConfig = {
  servers: Array<{
    name: string;
    command: string;
    args?: string[];
  }>;
};

export function getMcpConfigPath(cwd: string): string {
  return path.join(cwd, MCP_CONFIG_NAME);
}

export function loadMcpConfig(cwd: string): McpConfig {
  const p = getMcpConfigPath(cwd);
  if (!fs.existsSync(p)) {
    return { servers: [] };
  }
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw) as McpConfig;
    if (!Array.isArray(parsed.servers)) {
      return { servers: [] };
    }
    return parsed;
  } catch {
    return { servers: [] };
  }
}

export function saveMcpConfig(cwd: string, config: McpConfig): string {
  const p = getMcpConfigPath(cwd);
  fs.writeFileSync(p, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return p;
}

export function initMcpConfig(cwd: string): string {
  const existing = loadMcpConfig(cwd);
  if (existing.servers.length > 0) {
    return getMcpConfigPath(cwd);
  }
  return saveMcpConfig(cwd, {
    servers: [
      {
        name: 'example-mcp',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '.']
      }
    ]
  });
}

