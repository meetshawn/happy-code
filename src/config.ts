import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type HappyCodeConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTurns?: number;
};

const DEFAULT_MAX_TURNS = 24;
const MIN_MAX_TURNS = 1;
const MAX_MAX_TURNS = 200;

function parseMaxTurns(value: unknown): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
      ? Number.parseInt(value, 10)
      : Number.NaN;

  if (!Number.isFinite(parsed)) {
    return DEFAULT_MAX_TURNS;
  }

  return Math.max(MIN_MAX_TURNS, Math.min(MAX_MAX_TURNS, Math.trunc(parsed)));
}

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
  const normalized = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const parsed = JSON.parse(normalized) as Partial<HappyCodeConfig>;
  if (!parsed.baseUrl || !parsed.apiKey) {
    return null;
  }

  return {
    baseUrl: parsed.baseUrl,
    apiKey: parsed.apiKey,
    model: parsed.model ?? 'gpt-4o-mini',
    maxTurns: parseMaxTurns(parsed.maxTurns)
  };
}

export function writeConfig(config: HappyCodeConfig): void {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}
