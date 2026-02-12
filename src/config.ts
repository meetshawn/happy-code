import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type HappyCodeConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

const CONFIG_DIR = path.join(os.homedir(), '.happycode');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

export function getConfigPath(): string {
  return CONFIG_PATH;
}

export function ensureConfigDir(): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

export function readConfig(): HappyCodeConfig | null {
  if (!fs.existsSync(CONFIG_PATH)) {
    return null;
  }

  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  const parsed = JSON.parse(raw) as Partial<HappyCodeConfig>;
  if (!parsed.baseUrl || !parsed.apiKey) {
    return null;
  }

  return {
    baseUrl: parsed.baseUrl,
    apiKey: parsed.apiKey,
    model: parsed.model ?? 'gpt-4o-mini'
  };
}

export function writeConfig(config: HappyCodeConfig): void {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

