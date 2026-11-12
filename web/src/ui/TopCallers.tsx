import { useState } from 'react';
import { signedUsd, type CallerStat, type Leaderboard } from '@kumi-avax/sdk';
import { nameOf } from '../lib/signer';
import { Avatar, Notice, Obj } from './bits';

const pct = (v: number | null) => (v === null ? '–' : `${Math.round(v * 100)}%`);
const move = (bps: number | null) => (bps === null ? '–' : `${bps > 0 ? '+' : ''}${(bps / 100).toFixed(2)}%`);
const cls = (n: number | bigint | null) => (n === null || n === 0 || n === 0n ? '' : n > 0 ? 'up' : 'down');

/** Top callers, ranked from Fuji only: this chat or all public chats (same board as the phone's Top tab). */
export function TopCallers({ board, error, channel, channelName }: { board?: Leaderboard; error?: string; channel: number; channelName: string }) {
  const [scope, setScope] = useState<'chat' | 'all'>('chat');
  const list: CallerStat[] = board ? (scope === 'all' ? board.global : board.byChannel[channel] ?? []) : [];
  return <section className="card top-callers" aria-label="Top callers">
    <div className="card-head"><h3>Top callers</h3><div className="seg seg-mini">{(['chat', 'all'] as const).map(s => <button key={s} aria-pressed={scope === s} onClick={() => setScope(s)}>{s === 'chat' ? channelName : 'All chats'}</button>)}</div></div>
    {error && !board && <Notice error>Could not read the calls: {error}</Notice>}
    {!board && !error && <div className="skeleton" style={{ height: 150 }} />}
    {board && list.length === 0 && <div className="mini-empty"><Obj name="crown" size={44} still /><span>No calls here yet. Post one to get on the board.</span></div>}
    {board && list.length > 0 && <ol className="tc-list">
      {list.slice(0, 5).map(s => <li key={s.who} className="tc-row">
        <span className={`tc-rank ${s.rank <= 3 ? 'top' : ''}`}>{s.rank}</span>
        <Avatar id={s.who} />
        <span className="tc-who"><b>{nameOf(s.who)}</b><small>{s.calls} {s.calls === 1 ? 'call' : 'calls'} · {s.copies} {s.copies === 1 ? 'copy' : 'copies'} · copiers <span className={cls(s.copyPnl)}>{signedUsd(s.copyPnl)}</span></small></span>
        <span className="tc-num"><b>{pct(s.winRate)}</b><small className={cls(s.avgReturnBps)}>{move(s.avgReturnBps)}</small></span>
      </li>)}
    </ol>}
    {board && <p className="fine">Chainlink at the call vs now · copiers' PnL from KumiPerps fills, before funding</p>}
  </section>;
}
