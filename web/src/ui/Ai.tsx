import { useEffect, useState } from 'react';
import type { Address } from 'viem';
import { askOf, type AiAnswer, type AiDraft, type CallerStat } from '@kumi-avax/sdk';
import { askAi } from '../lib/kumiApi';
import { Ic } from './bits';
import { TokenLogo } from './logos';

const ICON: Record<string, string> = { order_book: 'book', chainlink_price: 'link', chat_activity: 'chat', caller_record: 'crews', top_callers: 'trophy', my_positions: 'jar', draft_call: 'bolt' };

/** Kumi AI turns for one chat, on this browser only (sessionStorage); nothing goes on chain. */
export function useAi(chat: string, me?: Address) {
  const key = `kumi:ai:${chat}`;
  const [list, setList] = useState<AiAnswer[]>(() => { try { return JSON.parse(sessionStorage.getItem(key) ?? '[]'); } catch { return []; } });
  const [asking, setAsking] = useState<{ q: string; at: number } | null>(null);
  useEffect(() => { try { sessionStorage.setItem(key, JSON.stringify(list.slice(-20))); } catch { /* private mode */ } }, [key, list]);
  const ask = async (q: string) => {
    if (!me) throw Error('Connect a wallet first: Kumi AI answers members of the chat.');
    if (!q) throw Error('Ask something after /ask, like /ask who is the best caller here?');
    setAsking({ q, at: Date.now() });
    try { const a = await askAi(me, chat, q); setList(l => [...l, a]); } finally { setAsking(null); }
  };
  return { list, asking, ask };
}
export { askOf };

/** Feed items and Kumi AI turns, in time order (seconds). */
export function interleave<T>(items: T[], tsOf: (t: T) => number, ai: AiAnswer[], asking: { q: string; at: number } | null): ({ item: T } | { ai: AiAnswer } | { pending: string })[] {
  const local: ({ ai: AiAnswer; ts: number } | { pending: string; ts: number })[] = ai.map(a => ({ ai: a, ts: a.at / 1000 }));
  if (asking) local.push({ pending: asking.q, ts: asking.at / 1000 });
  const out: ({ item: T } | { ai: AiAnswer } | { pending: string })[] = [];
  let i = 0;
  for (const it of items) {
    while (i < local.length && local[i]!.ts < tsOf(it)) out.push(local[i++]!);
    out.push({ item: it });
  }
  while (i < local.length) out.push(local[i++]!);
  return out;
}

export function AskLine({ q }: { q: string }) {
  return <div className="msg mine"><div style={{ minWidth: 0 }}><div className="bubble"><span className="ai-ask">/ask </span>{q}</div></div></div>;
}

function Head({ at }: { at?: number }) {
  return <div className="ai-head"><span className="brand-mark ai-mark" aria-hidden="true"><i /></span><b>Kumi AI</b><span className="chip chip-plum ai-tag">AI</span>{at ? <small>{new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small> : null}</div>;
}

export function AiPendingCard() {
  return <article className="ai-card" aria-busy="true"><Head /><p className="ai-wait"><span className="spin" />Reading Fuji…</p></article>;
}

export function AiCard({ a, isCrew, onDraft }: { a: AiAnswer; isCrew: boolean; onDraft: (d: AiDraft) => void }) {
  return <article className="ai-card" aria-label="Kumi AI answer">
    <Head at={a.at} />
    {a.tools.length > 0 && <div className="ai-tools">{a.tools.map((t, i) => <span key={`${t.name}-${i}`} className="chip chip-butter"><Ic name={ICON[t.name] ?? 'bolt'} size={12} />{t.label}</span>)}</div>}
    <p className="ai-answer">{a.answer}</p>
    {a.draft && <div className="ai-draft">
      <div className={`trade-top ${a.draft.side === 'long' ? '' : 'sell'}`}>
        <span className="asset-logo"><TokenLogo sym={a.draft.market} size={34} /></span>
        <div className="trade-title"><span className="trade-kind">Draft · not sent</span><b>{a.draft.side === 'long' ? 'Long' : 'Short'} {a.draft.market} {a.draft.leverage}x</b><span>{isCrew ? `${a.draft.sizePct}% of the fund` : `${a.draft.marginUsdc} tUSDC margin`}</span></div>
      </div>
      <div className="ai-draft-body">{a.draft.note && <p>"{a.draft.note}"</p>}<button className="btn btn-primary btn-sm" onClick={() => onDraft(a.draft!)}><Ic name="bolt" size={15} />{isCrew ? 'Pitch it' : 'Review and post'}</button></div>
    </div>}
    <small className="ai-foot">Only you see this · {a.model}</small>
  </article>;
}

/** Rank and win rate next to a caller's name (crown for a winning top-3 caller). */
export function CallerBadge({ s }: { s?: CallerStat | null }) {
  if (!s || s.winRate === null) return null;
  return <span className="caller-badge" title={`Caller #${s.rank}: ${s.wins} of ${s.scored} calls up since called`}>{s.rank <= 3 && s.winRate >= 0.5 && <img src="/art/3d/kumi-3d-crown.webp" alt="" width={14} height={14} />}#{s.rank} · {Math.round(s.winRate * 100)}%</span>;
}

export function SparkButton({ onClick }: { onClick: () => void }) {
  return <button type="button" className="ai-spark" aria-label="Ask Kumi AI" title="Ask Kumi AI" onClick={onClick}><Ic name="spark" size={18} /></button>;
}
