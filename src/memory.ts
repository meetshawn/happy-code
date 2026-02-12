import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MEMORY_PATH = path.join(os.homedir(), '.happycode', 'memory.md');

export function getMemoryPath(): string {
  return MEMORY_PATH;
}

export function readMemory(): string {
  if (!fs.existsSync(MEMORY_PATH)) {
    return '';
  }
  return fs.readFileSync(MEMORY_PATH, 'utf8');
}

export function appendMemory(note: string): void {
  fs.mkdirSync(path.dirname(MEMORY_PATH), { recursive: true });
  const chunk = `\n## ${new Date().toISOString()}\n${note.trim()}\n`;
  fs.appendFileSync(MEMORY_PATH, chunk, 'utf8');
}

export function clearMemory(): void {
  if (fs.existsSync(MEMORY_PATH)) {
    fs.unlinkSync(MEMORY_PATH);
  }
}

