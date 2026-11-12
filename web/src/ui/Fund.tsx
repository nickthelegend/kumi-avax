import { useState } from 'react';
import type { Abi } from 'viem';
import { crewAbi, usdcAbi, MARKETS, PX_SIZE, usd, price as fmtPrice, size as fmtSize, signedUsd } from '@kumi-avax/sdk';
import { USDC, type CrewState, type MarketState } from '../lib/chain';
import { nameOf, useWho, write } from '../lib/signer';
import { Addr, Avatar, Ic, MiniEmpty, Notice, Obj, Tx, ago, memberHue } from './bits';
import { TokenLogo } from './logos';

const SHARE = 10n ** 18n;
/** Price per share in tUSDC units (1e6 = $1.00 at launch). */
export const pps = (st: CrewState) => (st.totalShares > 0n ? st.nav * SHARE / st.totalShares : 1_000_000n);
export const retPct = (st: CrewState) => Number(pps(st) - 1_000_000n) / 10_000;

/** What closing the position right now would realise, at the book's best opposite price. */
export function bookPnl(pos: CrewState['positions'][number], mk?: MarketState) {
  if (!mk) return null;
  const px = pos.size > 0n ? mk.bestBid : mk.bestAsk;
  if (px === 0n) return null;
  return BigInt(pos.size) * (px - BigInt(pos.entry)) / PX_SIZE;
}

export function FundPane({ st, markets, onChipIn, onQuit }: { st: CrewState; markets: MarketState[]; onChipIn: () => void; onQuit: () => void }) {
  const who = useWho();
  const ret = retPct(st);
  const upnl = st.positions.reduce((a, p) => a + p.unrealized - p.fundingOwed, 0n);
  const exposure = st.positions.reduce((a, p) => a + p.notional, 0n);
  const lev = st.nav > 0n ? Number(exposure * 100n / st.nav) / 100 : 0;
  const mineValue = st.me && st.totalShares > 0n ? st.nav * st.me.shares / st.totalShares : 0n;
  return <>
    <section className="hero-card" aria-label="Crew fund">
      <div className="row-between"><span className="label">Crew fund · NAV</span><span className="verify" title="Read from the KumiPerps account on Fuji"><i />On-chain</span></div>
      <div className="big" data-nav>{usd(st.nav)} <small>tUSDC</small></div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <span className={`ret ${ret < 0 ? 'neg' : ''}`}>{ret >= 0 ? '+' : ''}{ret.toFixed(2)}%</span>
        <span className="sub">since launch · ${(Number(pps(st)) / 1e6).toFixed(4)} a share</span>
      </div>
      <div className="hero-stats">
        <span><small>Open PnL</small><b className={upnl >= 0n ? 'pos' : 'neg'}>{signedUsd(upnl)}</b></span>
        <span><small>Exposure</small><b>${usd(exposure, 0)}</b></span>
        <span><small>Leverage</small><b>{lev.toFixed(2)}x <em>/ {st.policy.maxLeverage}x</em></b></span>
      </div>
    </section>

    <section className="card" aria-label="Open positions">
      <div className="card-head"><h3>Positions</h3><span className="chip chip-mint chip-live"><span className="dot" />Live</span></div>
      {st.positionsError && <Notice error>Could not mark positions: a Chainlink feed is older than the venue accepts.</Notice>}
      {st.positions.length === 0 && !st.positionsError && <MiniEmpty obj="rocket">No open positions. Pitch one in the chat: <span className="mono">/long AVAX 3x 20%</span>.</MiniEmpty>}
      {st.positions.map(p => {
        const m = MARKETS[p.market]!;
        const mk = markets[p.market];
        const book = bookPnl(p, mk);
        const long = p.size > 0n;
        const pnl = p.unrealized - p.fundingOwed;
        return <div key={p.market} className="position" data-position={m.symbol}>
          <div className="pos-top">
            <TokenLogo sym={m.symbol} size={36} />
            <div className="pos-id"><b>{m.symbol} <span className={`side-tag ${long ? 'long' : 'short'}`}>{long ? 'Long' : 'Short'}</span></b><small>{fmtSize(long ? BigInt(p.size) : -BigInt(p.size), m.sizeDp)} {m.symbol} · ${usd(p.notional, 0)}</small></div>
            <div className={`pos-pnl ${pnl >= 0n ? 'up' : 'down'}`} data-upnl>{signedUsd(pnl)}<small>at Chainlink</small></div>
          </div>
          <dl className="pos-grid">
            <div><dt>Entry</dt><dd>${fmtPrice(BigInt(p.entry), m.priceDp === 0 ? 0 : 3)}</dd></div>
            <div><dt>Chainlink</dt><dd>${fmtPrice(p.mark, m.priceDp === 0 ? 0 : 3)}</dd></div>
            <div><dt>Close now</dt><dd className={book !== null && book >= 0n ? 'up' : 'down'}>{book === null ? 'no bids' : signedUsd(book)}</dd></div>
            <div><dt>Liquidation</dt><dd>{p.liqPrice > 0n ? `$${fmtPrice(p.liqPrice, m.priceDp === 0 ? 0 : 3)}` : 'none'}</dd></div>
            <div><dt>Funding</dt><dd>{signedUsd(-p.fundingOwed, 4)}</dd></div>
          </dl>
        </div>;
      })}
    </section>

    <section className="card" aria-label="Your stake">
      <div className="card-head"><h3>Your stake</h3>{st.me?.isMember && <span className="chip chip-butter">Member</span>}</div>
      {!who ? <MiniEmpty obj="jar">Connect a wallet to chip in, vote and pitch.</MiniEmpty>
        : !st.me?.isMember ? <MiniEmpty obj="jar">{st.name} is invite-only. A member can invite you with <span className="mono">/invite {who.address.slice(0, 6)}…</span>.</MiniEmpty>
        : <>
          <div className="tiles">
            <div className="tile tone-butter"><span className="label">Your share</span><div className="v">{st.totalShares > 0n ? (Number(st.me.shares * 10000n / st.totalShares) / 100).toFixed(1) : '0.0'}%</div></div>
            <div className="tile tone-mint"><span className="label">Worth now</span><div className="v">${usd(mineValue)}</div></div>
          </div>
          <div className="stake-actions">
            <button className="btn btn-butter" onClick={onChipIn}><Ic name="jar" size={16} />Chip in</button>
            <button className="btn btn-pink" onClick={onQuit} disabled={st.me.shares === 0n}><Ic name="exit" size={16} />Ragequit</button>
          </div>
          <p className="fine">Wallet: {usd(st.me.usdc)} tUSDC</p>
        </>}
    </section>

    <section className="card" aria-label="Members">
      <div className="card-head"><h3>Members</h3><span className="label">{st.members.length} · share-weighted votes</span></div>
      {st.members.map(m => {
        const pct = st.totalShares > 0n ? Number(m.shares * 10000n / st.totalShares) / 100 : 0;
        return <div key={m.address} className="member">
          <Avatar id={m.address} />
          <div><div className="n">{nameOf(m.address)}{m.address.toLowerCase() === st.captain.toLowerCase() && <span className="chip chip-coral" title="Can trade without a vote, inside the captain limits">Captain</span>}</div><div className="s">${usd(st.totalShares > 0n ? st.nav * m.shares / st.totalShares : 0n)}</div></div>
          <div className="share" style={{ ['--tone' as string]: memberHue(m.address) }}>{pct.toFixed(1)}%<i><b style={{ width: `${pct}%` }} /></i></div>
        </div>;
      })}
    </section>

    <section className="card policy" aria-label="Crew rules">
      <div className="card-head"><h3>Crew rules</h3><Obj name="shield" size={52} /></div>
      <ul className="rules-list">
        <li><b>{(st.policy.thresholdBps / 100).toFixed(2)}%</b> of shares must vote yes · pitches stay open {Math.round(st.policy.votingPeriod / 3600)} h</li>
        <li>Crew leverage capped at <b>{st.policy.maxLeverage}x</b> of NAV, across all positions</li>
        <li>Fills at most <b>{st.policy.maxSlippageBps / 100}%</b> from the Chainlink price</li>
        <li>Captain {nameOf(st.captain) || 'none'}: up to <b>{st.policy.captainMaxLeverage}x</b>, <b>{st.policy.captainMaxBps / 100}%</b> of NAV, <b>{st.policy.captainTradesPerDay}</b> trades a day, no vote</li>
        <li>Ragequit any time: your slice of each position closes first, you take what it leaves</li>
      </ul>
      <p className="fine">Vault <Addr a={st.address} /> · read {ago(Math.floor(st.readAt / 1000))}</p>
    </section>
  </>;
}

export function ChipInSheet({ st, onClose, onDone }: { st: CrewState; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState('250');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string[]>([]);
  const units = BigInt(Math.round(Number(amount || '0') * 1e6));
  const bal = st.me?.usdc ?? 0n;
  const minted = st.totalShares === 0n || st.nav <= 0n ? units * 10n ** 12n : units * st.totalShares / st.nav;
  async function run(label: string, f: () => Promise<string>) {
    setBusy(label); setErr(null);
    try { const h = await f(); setDone(d => [...d, h]); onDone(); return true; } catch (e) { setErr((e as Error).message); return false; } finally { setBusy(null); }
  }
  async function chipIn() {
    if ((st.me?.allowance ?? 0n) < units && !(await run('approve', () => write(USDC, usdcAbi as Abi, 'approve', [st.address, 2n ** 256n - 1n])))) return;
    await run('deposit', () => write(st.address, crewAbi as Abi, 'deposit', [units]));
  }
  return <div className="scrim" onClick={onClose}><div className="sheet" role="dialog" aria-label="Chip in" onClick={e => e.stopPropagation()}>
    <div className="head-obj"><Obj name="jar" size={64} /><div><h3>Chip in to {st.name}</h3><p className="sub">Shares are minted at the fund's marked NAV, so you buy in at a fair price even with positions open.</p></div></div>
    <label className="field"><span className="label">Amount (tUSDC)</span><input className="input mono" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} /></label>
    <div className="payout">
      <div className="row-between"><span>Wallet</span><span className="mono">{usd(bal)} tUSDC</span></div>
      <div className="row-between"><span>You get</span><span className="mono">{(Number(minted / 10n ** 14n) / 10_000).toFixed(2)} shares</span></div>
      <div className="row-between"><span>Your share after</span><span className="mono">{((Number(((st.me?.shares ?? 0n) + minted) * 10000n / (st.totalShares + minted || 1n))) / 100).toFixed(1)}%</span></div>
    </div>
    {bal < units && <Notice>Not enough tUSDC. The test faucet gives 1,000 a day. <button className="btn btn-sm btn-mint" disabled={!!busy} onClick={() => run('faucet', () => write(USDC, usdcAbi as Abi, 'faucet'))}>{busy === 'faucet' ? 'Minting…' : 'Get 1,000 tUSDC'}</button></Notice>}
    {err && <Notice error>{err}</Notice>}
    {done.length > 0 && <div className="done-row"><Obj name="success" size={40} />Done {done.map(h => <Tx key={h} hash={h} />)}</div>}
    <div className="row"><button className="btn btn-ghost" onClick={onClose}>Close</button><button className="btn btn-primary btn-block" disabled={!!busy || units <= 0n || units > bal} onClick={chipIn}>{busy === 'approve' ? 'Approving tUSDC…' : busy === 'deposit' ? 'Chipping in…' : `Chip in ${amount || 0} tUSDC`}</button></div>
  </div></div>;
}

export function QuitSheet({ st, markets, onClose, onDone }: { st: CrewState; markets: MarketState[]; onClose: () => void; onDone: () => void }) {
  const [pct, setPct] = useState(100);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hash, setHash] = useState<string>();
  const mine = st.me?.shares ?? 0n;
  const burn = pct === 100 ? mine : mine * BigInt(pct) / 100n;
  const share = st.totalShares > 0n ? st.nav * burn / st.totalShares : 0n;
  // Closing cost estimate: the slice sells at the best opposite price instead of Chainlink.
  const cost = st.positions.reduce((a, p) => {
    const mk = markets[p.market];
    if (!mk || st.totalShares === 0n) return a;
    const slice = BigInt(p.size) * burn / st.totalShares;
    const px = p.size > 0n ? mk.bestBid : mk.bestAsk;
    if (px === 0n) return a;
    return a + (slice > 0n ? slice * (p.mark - px) : -slice * (px - p.mark)) / PX_SIZE;
  }, 0n);
  async function go() {
    setBusy(true); setErr(null);
    try { setHash(await write(st.address, crewAbi as Abi, 'ragequit', [burn])); onDone(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return <div className="scrim" onClick={onClose}><div className="sheet" role="dialog" aria-label="Ragequit" onClick={e => e.stopPropagation()}>
    <div className="head-obj"><Obj name="door" size={64} /><div><h3>Ragequit</h3><p className="sub">Leave with your exact share. {st.positions.length > 0 ? 'Your slice of each open position closes on the order book first, and you pay that spread, so the crew keeps exactly what it had.' : 'No positions are open, so it is paid straight from the fund.'}</p></div></div>
    <div className="seg seg4">{[25, 50, 100].map(v => <button key={v} aria-pressed={pct === v} onClick={() => setPct(v)}>{v === 100 ? 'Everything' : `${v}%`}</button>)}</div>
    <div className="payout">
      <div className="row-between"><span>Your slice of NAV</span><span className="mono">{usd(share)} tUSDC</span></div>
      {st.positions.length > 0 && <div className="row-between"><span>Closing your slice (est.)</span><span className="mono">−{usd(cost > 0n ? cost : 0n)}</span></div>}
      <div className="row-between"><b>You receive about</b><b className="mono">{usd(share - (cost > 0n ? cost : 0n))} tUSDC</b></div>
    </div>
    {pct === 100 && <p className="fine">Leaving with every share ends your membership, and your open votes stop counting.</p>}
    {err && <Notice error>{err}</Notice>}
    {hash && <div className="done-row"><Obj name="door" size={40} />You left. <Tx hash={hash} /></div>}
    <div className="row"><button className="btn btn-ghost" onClick={onClose}>{hash ? 'Close' : 'Stay'}</button>{!hash && <button className="btn btn-pink btn-block" disabled={busy || burn === 0n} onClick={go}>{busy ? 'Closing slice and paying out…' : 'Ragequit'}</button>}</div>
  </div></div>;
}
