/** The web's side of Kumi's API (v2.2): Kumi AI with a one-hour pass signed by the connected wallet, and the caller board. */
import type { Address } from 'viem';
import { DEPLOYMENT, KUMI_API, askKumi, askMessage, readLeaderboard, type AiAnswer, type AiError, type AskPass, type Leaderboard } from '@kumi-avax/sdk';
import { PERPS, pub } from './chain';
import { signText } from './signer';

export const API = (import.meta.env.VITE_KUMI_API as string | undefined) ?? KUMI_API;

let pass: AskPass | null = null;
async function askPass(me: Address): Promise<AskPass> {
  const now = Math.floor(Date.now() / 1000);
  if (pass && pass.address.toLowerCase() === me.toLowerCase() && pass.expires - now > 120) return pass;
  const expires = now + 3500;
  pass = { address: me, expires, signature: await signText(askMessage(me, expires)) };
  return pass;
}

export async function askAi(me: Address, chat: string, question: string): Promise<AiAnswer> {
  let r: AiAnswer | AiError = await askKumi({ api: API, chat, question, pass: await askPass(me) });
  if ('error' in r && r.status === 401) { pass = null; r = await askKumi({ api: API, chat, question, pass: await askPass(me) }); }
  if ('error' in r) throw Error(r.error);
  return r;
}

let last: { at: number; p: Promise<Leaderboard> } | null = null;
export function readBoard(): Promise<Leaderboard> {
  if (!last || Date.now() - last.at > 20_000) {
    const p = readLeaderboard(pub as any, { lobby: DEPLOYMENT.lobby as Address, perps: PERPS, fromBlock: BigInt(DEPLOYMENT.perpsDeployBlock) });
    last = { at: Date.now(), p };
    p.catch(() => { last = null; });
  }
  return last.p;
}
