/**
 * The phone's side of Kumi's API (v2.2): the gas-free start and Kumi AI. The phone signs; the API never sees a key.
 */
import type { Address, Hex } from 'viem';
import { DEPLOYMENT, KUMI_API, askKumi, askMessage, requestGas, type AiAnswer, type AiError, type AskPass } from '@kumi-avax/sdk';
import { pub } from './chain';
import { signer } from './wallet';

export const API = (process.env.EXPO_PUBLIC_KUMI_API as string | undefined) ?? KUMI_API;
const STATION = DEPLOYMENT.gasStation as Address | null;

export class SetupError extends Error {}

/**
 * Gets this wallet its first gas from KumiGasStation: signs the request here, the API relays it, then waits until
 * Fuji shows the AVAX. Throws a readable error (SetupError when the sponsor is not configured or empty).
 */
export async function getGas(): Promise<{ hash: Hex; amount: string }> {
  if (!STATION) throw new SetupError('Setup required: KumiGasStation is not deployed.');
  const me = signer();
  const block = await pub.getBlock({ blockTag: 'latest' });
  const r = await requestGas({ api: API, station: STATION, address: me.address, now: block.timestamp, sign: raw => me.signMessage({ message: { raw } }) });
  if (!r.ok) throw r.setup ? new SetupError(r.error) : Error(r.error);
  for (let i = 0; i < 30; i++) {
    if ((await pub.getBalance({ address: me.address })) > 0n) break;
    await new Promise(res => setTimeout(res, 700));
  }
  return { hash: r.hash, amount: r.amount };
}

let pass: AskPass | null = null;
/** A one-hour Kumi AI pass, signed on this phone (no prompt: the key is the phone's own). */
async function askPass(): Promise<AskPass> {
  const me = signer();
  const now = Math.floor(Date.now() / 1000);
  if (pass && pass.address === me.address && pass.expires - now > 120) return pass;
  const expires = now + 3500;
  pass = { address: me.address, expires, signature: await me.signMessage({ message: askMessage(me.address, expires) }) };
  return pass;
}

export async function askAi(chat: string, question: string): Promise<AiAnswer> {
  let r: AiAnswer | AiError = await askKumi({ api: API, chat, question, pass: await askPass() });
  if ('error' in r && r.status === 401) { pass = null; r = await askKumi({ api: API, chat, question, pass: await askPass() }); }
  if ('error' in r) throw r.setup ? new SetupError(r.error) : Error(r.error);
  return r;
}
