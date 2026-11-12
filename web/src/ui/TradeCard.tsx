import { useEffect, useState } from 'react';
import { crewAbi, MARKETS, Kind, PX_SIZE, usd, price as fmtPrice, size as fmtSize, signedUsd } from '@kumi-avax/sdk';
import type { Abi, Address } from 'viem';
import { feedTx, type CrewState, type MarketState, type Proposal } from '../lib/chain';
import { nameOf, useWho, write } from '../lib/signer';
import { Avatar, Ic, Notice, Tx } from './bits';
import { TokenLogo } from './logos';

type FeedItem = CrewState['feed'][number];

/** A pitched trade: coral for a long, plum for a short, butter vote band, then the fill from the order book. */
export function TradeCard({ item, p, st, markets, events, onDone }: { item: FeedItem; p?: Proposal; st: CrewState; markets: MarketState[]; events: FeedItem[]; onDone: () => void }) {
  const who = useWho();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [hash, setHash] = useState<string>();
  const [execHash, setExecHash] = useState<string>();
  const exec = events.find(e => e.kind === 4 && e.ref === item.ref);
  useEffect(() => { void feedTx(st.address, item.index, item.block).then(setHash).catch(() => undefined); }, [st.address, item.index, item.block]);
  useEffect(() => { if (exec) void feedTx(st.address, exec.index, exec.block).then(setExecHash).catch(() => undefined); }, [st.address, exec?.index, exec?.block]);

  if (!p) return <div className="trade skeleton" style={{ height: 210 }} aria-label="Loading pitch" />;
  const m = MARKETS[p.market]!;
  const mk = markets[p.market];
  const isOpen = p.kind === Kind.Open;
  const isClose = p.kind === Kind.Close;
  const expired = !p.executed && Date.now() / 1000 > Number(p.deadline);
  const failed = !p.executed && events.some(e => e.kind === 5 && e.ref === item.ref);
  const status = p.executed ? (isClose ? 'Closed' : isOpen ? 'Opened' : 'Done') : expired ? 'Expired' : failed ? 'Venue refused' : 'Voting';
  const stCls = p.executed ? 'st-executed' : expired || failed ? 'st-failed' : 'st-voting';
  const total = st.totalShares;
  const yesPct = total > 0n ? Number(p.yesShares * 10000n / total) / 100 : 0;
  const noPct = total > 0n ? Number(p.noShares * 10000n / total) / 100 : 0;
  const needPct = st.policy.thresholdBps / 100;
  const passed = p.yesShares >= p.needed && p.yesShares > 0n;
  const canVote = !!who && !!st.me?.isMember && (st.me?.shares ?? 0n) > 0n && p.myVote === 0 && !p.executed && !expired;
  const canRetry = !!who && !!st.me?.isMember && passed && !p.executed && !expired;
  const mine = who?.address.toLowerCase() === p.proposer.toLowerCase();

  // Before execution: what the vote would open at today's NAV and Chainlink price.
  const nav = st.nav > 0n ? st.nav : 0n;
  const margin = nav * BigInt(p.sizeBps) / 10000n;
  const notional = margin * BigInt(p.leverage);
  const estSize = mk && mk.oracle > 0n ? notional * PX_SIZE / mk.oracle : 0n;

  async function act(label: string, fn: string, args: unknown[]) {
    setBusy(label); setErr(null);
    try { await write(st.address, crewAbi as Abi, fn, args); onDone(); } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }

  const title = isOpen ? `${p.isLong ? 'Long' : 'Short'} ${m.symbol} ${p.leverage}x` : isClose ? `Close ${m.symbol}${p.sizeBps < 10000 ? ` ${p.sizeBps / 100}%` : ''}` : p.kind === Kind.SetCaptain ? 'New captain' : 'Invite';
  const kindLabel = isOpen ? `${p.sizeBps / 100}% of the fund` : isClose ? 'of the open position' : p.kind === Kind.SetCaptain ? nameOf(p.target) : nameOf(p.target);
  return (
    <article className={`trade ${mine ? 'mine' : ''}`} data-trade={item.ref} data-status={status.toLowerCase()} data-vote={!p.executed && !expired ? 'open' : undefined}>
      <div className={`trade-top ${isOpen && !p.isLong ? 'sell' : ''} ${isClose ? 'close' : ''}`}>
        <span className="asset-logo"><TokenLogo sym={m.symbol} size={42} /></span>
        <div className="trade-title">
          <span className="trade-kind">{nameOf(p.proposer)} pitched · #{item.ref}</span>
          <b>{title}</b>
          <span>{kindLabel}</span>
        </div>
        <span className={`status ${stCls}`}><i />{status}</span>
      </div>
      <div className="trade-body">
        {isOpen && (p.executed ? (
          <div className="quote">
            <div><span className="label">Margin used</span><div className="v">${usd(p.filled * BigInt(p.avgPrice) / PX_SIZE / BigInt(p.leverage))}</div></div>
            <span className="arrow"><Ic name="arrow" /></span>
            <div className="r"><span className="label">Filled on the book</span><div className="v qv qv-r">{fmtSize(p.filled, m.sizeDp)} {m.symbol} <small>@ ${fmtPrice(BigInt(p.avgPrice), m.priceDp === 0 ? 0 : 3)}</small></div></div>
          </div>
        ) : (
          <div className="quote">
            <div><span className="label">Margin now</span><div className="v">${usd(margin)}</div></div>
            <span className="arrow"><Ic name="arrow" /></span>
            <div className="r"><span className="label">{p.leverage}x position</span><div className="v">${usd(notional)} <small>≈ {fmtSize(estSize, m.sizeDp)} {m.symbol}</small></div></div>
          </div>
        ))}
        {isClose && p.executed && (
          <div className={`pnl-band ${p.resultPnl >= 0n ? 'up' : 'down'}`}>
            <span>Realised PnL</span><b>{signedUsd(p.resultPnl)} <small>tUSDC</small></b>
            <span className="faint">sold {fmtSize(p.filled, m.sizeDp)} {m.symbol} @ ${fmtPrice(BigInt(p.avgPrice), m.priceDp === 0 ? 0 : 3)}</span>
          </div>
        )}
        {isOpen && !p.executed && <div className="intents"><span>Executes as an IOC order, at most {st.policy.maxSlippageBps / 100}% from Chainlink</span><span className="mono">{mk ? `$${fmtPrice(mk.oracle, m.priceDp === 0 ? 0 : 3)}` : ''}</span></div>}
        <div className="vote-band">
          <div className="row-between"><span><b>{yesPct.toFixed(1)}%</b> yes{noPct > 0 ? ` · ${noPct.toFixed(1)}% no` : ''}</span><span>needs {needPct.toFixed(2)}% of shares</span></div>
          <div className="share-bar" role="img" aria-label={`${yesPct.toFixed(1)}% of shares voted yes, ${needPct}% needed`}>
            <i className="yes" style={{ width: `${Math.min(100, yesPct)}%` }} />
            <i className="no" style={{ width: `${Math.min(100 - yesPct, noPct)}%` }} />
            <span className="need" style={{ left: `${needPct}%` }} />
          </div>
          <div className="voters">{p.votes.map(v => <span key={v.voter} className={`voter ${v.support ? 'y' : 'n'}`} title={`${nameOf(v.voter)} voted ${v.support ? 'yes' : 'no'}`}><Avatar id={v.voter} />{nameOf(v.voter)}</span>)}</div>
          {canVote && <div className="vote-actions">
            <button className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => act('yes', 'vote', [BigInt(item.ref), true])}><Ic name="thumb" size={15} />{busy === 'yes' ? 'Voting…' : 'Vote yes'}</button>
            <button className="btn btn-sm" disabled={!!busy} onClick={() => act('no', 'vote', [BigInt(item.ref), false])}><Ic name="thumbDown" size={15} />{busy === 'no' ? 'Voting…' : 'Vote no'}</button>
          </div>}
          {canRetry && <button className="btn btn-butter btn-sm" disabled={!!busy} onClick={() => act('exec', 'execute', [BigInt(item.ref)])}><Ic name="bolt" size={15} />{busy === 'exec' ? 'Executing…' : 'Vote passed: execute now'}</button>}
          {!p.executed && !expired && p.myVote !== 0 && <span className="fine">You voted {p.myVote > 0 ? 'yes' : 'no'}. When yes passes {needPct.toFixed(2)}%, the last vote opens it.</span>}
          {failed && !p.executed && <span className="fine">The vote passed but the venue refused the order (liquidity or margin). The vote stands; anyone in the crew can retry.</span>}
        </div>
        {err && <Notice error>{err}</Notice>}
        <div className="txs">{hash && <Tx hash={hash} label="pitch" />}{execHash && <Tx hash={execHash} label={isClose ? 'close' : 'open'} />}<span className="faint mono">expires {new Date(Number(p.deadline) * 1000).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</span></div>
      </div>
    </article>
  );
}

export const asAddress = (a: string) => a as Address;
