/**
 * Kumi AI client (v2.2), shared by the phone and the web. The agent runs on Kumi's API (Claude Haiku 5.5, key on the
 * server only) with read-only tools over live Fuji. A wallet signs one short pass that is good for an hour; the API
 * checks it and that the wallet is in the chat on-chain before it answers.
 */
import type { Address, Hex } from 'viem';
import { KUMI_API } from './gas.ts';
import type { MarketSym } from './markets.ts';

export const askMessage = (address: string, expires: number) => `Kumi AI\nwallet: ${address.toLowerCase()}\nexpires: ${expires}`;

export type AskPass = { address: Address; expires: number; signature: Hex };
export type AiTool = { name: string; label: string };
export type AiDraft = { market: MarketSym; side: 'long' | 'short'; leverage: number; marginUsdc?: number; sizePct?: number; note?: string; command?: string };
export type AiAnswer = { id: string; chat: string; question: string; answer: string; tools: AiTool[]; draft?: AiDraft; at: number; model: string };
export type AiError = { error: string; setup?: boolean; status: number };

/** `/ask what is the spread?` → the question; null when the text is not an /ask. */
export function askOf(text: string): string | null {
  const m = /^\/ask(?:\s+([\s\S]*))?$/i.exec(text.trim());
  return m ? (m[1] ?? '').trim() : null;
}

export async function askKumi(opts: { api?: string; chat: string; question: string; pass: AskPass }): Promise<AiAnswer | AiError> {
  let r: Response;
  try {
    r = await fetch(`${opts.api ?? KUMI_API}/api/ask`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat: opts.chat, question: opts.question, ...opts.pass }) });
  } catch (e) {
    return { status: 0, error: `Kumi AI did not answer (${(e as Error).message}).` };
  }
  const body = await r.json().catch(() => ({ error: `Kumi AI answered ${r.status}` }));
  if (!r.ok) return { status: r.status, error: body.error ?? `Kumi AI answered ${r.status}`, setup: !!body.setup };
  return { ...body, chat: opts.chat, question: opts.question } as AiAnswer;
}
