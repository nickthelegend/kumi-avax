/**
 * Keys for the Fuji run live only in the repo's gitignored .env. This module reads them by name;
 * nothing here prints a key. `ensureKeys` creates any missing test account once.
 */
import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const ENV = join(ROOT, '.env');
/** deployer, maker bot, three crew members (also the web app's QA signers). */
export const ROLES = ['KUMI_DEPLOYER_KEY', 'KUMI_MAKER_KEY', 'KUMI_MIKA_KEY', 'KUMI_BO_KEY', 'KUMI_REN_KEY'] as const;
export type Role = (typeof ROLES)[number];
export const MEMBERS = ['KUMI_MIKA_KEY', 'KUMI_BO_KEY', 'KUMI_REN_KEY'] as const;

export function readEnv(file = ENV): Record<string, string> {
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (m) out[m[1]!] = m[2]!.replace(/^['"]|['"]$/g, '');
  }
  return out;
}

export function ensureKeys(): void {
  const env = readEnv();
  for (const role of ROLES) if (!env[role]) appendFileSync(ENV, `${role}=${generatePrivateKey()}\n`, { mode: 0o600 });
}

export function account(role: Role) {
  const key = readEnv()[role];
  if (!key) throw Error(`Setup required: ${role} in .env (run pnpm --filter @kumi-avax/scripts keys)`);
  return privateKeyToAccount(key as Hex);
}
