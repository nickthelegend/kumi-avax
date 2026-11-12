// Reads keys by name for the live tests (never printed): the repo's gitignored .env and Nick's Anthropic env file.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
export function readEnv(file: string): Record<string, string> {
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (m) out[m[1]!] = m[2]!.replace(/^['"]|['"]$/g, '');
  }
  return out;
}
export const REPO_ENV = readEnv(join(import.meta.dirname, '../../.env'));
export const ANTHROPIC_ENV = readEnv(join(homedir(), '.config/grokbot/anthropic.env'));
