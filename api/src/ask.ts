/**
 * POST /api/ask { chat, question, address, expires, signature }: Kumi AI, a Claude agent (claude-haiku-5-5) that
 * answers in a Kumi chat with read-only tools over live Fuji, and can draft a call card the asker signs themselves.
 * The Anthropic key stays on the server. The asker proves the wallet with a signed one-hour pass, must be in the chat
 * on-chain, and is rate limited per wallet, per IP and per instance.
 */
import Anthropic from '@anthropic-ai/sdk';
import { isAddress, isHex, verifyMessage, type Address, type Hex, type PublicClient } from 'viem';
import { askMessage } from '@kumi-avax/sdk';
import { Limiter, setup, type Reply } from './http.ts';
import { LABEL, TOOLS, cachedBoard, chatOf, isMemberOf, nameOf, runTool, type Ctx } from './tools.ts';

export const MODEL = 'claude-haiku-5-5';
const perWallet = new Limiter(8, 10 * 60_000);
const perIp = new Limiter(12, 10 * 60_000);
const perInstance = new Limiter(200, 60 * 60_000);
const MAX_TURNS = 6;

const SYSTEM = `You are Kumi AI, inside Kumi: group chats on Avalanche where friends call perps trades and copy them on an on-chain order book (KumiPerps) on the Fuji testnet, marked to Chainlink. Money is test USDC (tUSDC).

You answer one person's question in the chat they are in. Use the tools for every number: the live order book, Chainlink, this chat's calls and copies, caller track records, the asker's positions. Never invent a price, size, PnL or name. If a tool fails, say what you could not read.

You cannot sign, send, trade, copy or move funds. When the asker wants a call or a trade idea, use draft_call: the app shows it as a card they review and sign themselves. Do not tell people what they should trade otherwise; say what the data shows.

Style: plain text for a phone chat bubble, at most about 80 words, no markdown headings or tables, short sentences, numbers with units (tUSDC, %, $). Say "on Fuji testnet" only when it matters.`;

export type AskEnv = { ANTHROPIC_API_KEY?: string };

export async function handleAsk(body: any, ip: string, env: AskEnv, pub: PublicClient, client?: Anthropic): Promise<Reply> {
  if (!env.ANTHROPIC_API_KEY && !client) return setup('ANTHROPIC_API_KEY on Kumi\'s API.');
  const { chat: chatId, question, address, expires, signature } = body ?? {};
  if (typeof question !== 'string' || !question.trim()) return { status: 400, body: { error: 'Ask something after /ask.' } };
  if (question.length > 500) return { status: 400, body: { error: 'Keep the question under 500 characters.' } };
  if (typeof address !== 'string' || !isAddress(address)) return { status: 400, body: { error: 'address must be a Fuji (EVM) address.' } };
  const now = Math.floor(Date.now() / 1000);
  if (typeof expires !== 'number' || expires < now || expires > now + 3600 + 60) return { status: 401, body: { error: 'The Kumi AI pass expired. Ask again.', expired: true } };
  if (typeof signature !== 'string' || !isHex(signature)) return { status: 401, body: { error: 'Sign the Kumi AI pass with this wallet.' } };
  const ok = await verifyMessage({ address: address as Address, message: askMessage(address, expires), signature: signature as Hex }).catch(() => false);
  if (!ok) return { status: 401, body: { error: 'The Kumi AI pass is not signed by this wallet.' } };

  let chat;
  try { chat = await chatOf(pub, String(chatId ?? '')); } catch (e) { return { status: 400, body: { error: (e as Error).message } }; }
  if (!(await isMemberOf(pub, chat, address as Address))) return { status: 403, body: { error: `Join ${chat.name} first: Kumi AI answers members of the chat.` } };

  for (const [lim, key, what] of [[perWallet, address.toLowerCase(), 'this wallet'], [perIp, ip, 'this network'], [perInstance, 'all', 'Kumi AI']] as const) {
    const r = lim.take(key);
    if (!r.ok) return { status: 429, body: { error: `Kumi AI is busy for ${what}. Try again in ${Math.max(1, Math.ceil(r.retryS / 60))} min.` } };
  }

  const anthropic = client ?? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 45_000 });
  const ctx: Ctx = { pub, chat, me: address as Address, board: cachedBoard(pub) };
  const context = `Chat: ${chat.name} (${chat.kind === 'lobby' ? 'public chat' : 'crew vault'}). Asker: ${nameOf(address)} (${address}). Time: ${new Date().toISOString()}.`;
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: `${context}\n\nQuestion: ${question.trim()}` }];
  const used: { name: string; label: string }[] = [];
  const t0 = Date.now();
  let answer = '';
  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const res = await anthropic.messages.create({ model: MODEL, max_tokens: 2000, system: SYSTEM, tools: TOOLS as unknown as Anthropic.Tool[], output_config: { effort: 'low' }, messages });
      if (res.stop_reason === 'refusal') { answer = 'Kumi AI can\'t help with that one.'; break; }
      const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('\n').trim();
      const calls = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      if (res.stop_reason !== 'tool_use' || calls.length === 0) { answer = text; break; }
      messages.push({ role: 'assistant', content: res.content });
      const results: Anthropic.ToolResultBlockParam[] = await Promise.all(calls.map(async c => {
        used.push({ name: c.name, label: (LABEL[c.name] ?? (() => c.name))(c.input) });
        try {
          const out = await runTool(c.name, c.input, ctx);
          return { type: 'tool_result' as const, tool_use_id: c.id, content: JSON.stringify(out, (_, v) => (typeof v === 'bigint' ? v.toString() : v)) };
        } catch (e) {
          return { type: 'tool_result' as const, tool_use_id: c.id, content: `Could not read it: ${(e as Error).message.split('\n')[0]}`, is_error: true };
        }
      }));
      messages.push({ role: 'user', content: results });
      if (turn === MAX_TURNS - 1) answer = text || 'Kumi AI ran out of steps on that one. Ask a narrower question.';
    }
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return setup('a valid ANTHROPIC_API_KEY on Kumi\'s API.');
    if (e instanceof Anthropic.RateLimitError) return { status: 429, body: { error: 'Kumi AI is rate limited by the model provider. Try again in a minute.' } };
    if (e instanceof Anthropic.APIError) return { status: 502, body: { error: `Kumi AI's model call failed (${e.status ?? 'network'}).` } };
    throw e;
  }
  if (!answer) answer = 'No answer came back. Try asking again.';
  return { status: 200, body: { id: `ai-${t0.toString(36)}`, answer, tools: used, draft: ctx.draft, at: Date.now(), model: MODEL, ms: Date.now() - t0 } };
}
