import { useMemo, useRef } from 'react';
import { MARKETS, price as fmtPrice, size as fmtSize, usd, PX_SIZE, addressUrl } from '@kumi-avax/sdk';
import { PERPS, readBook, readMarkets, recentFills, useLive, type MarketState } from '../lib/chain';
import { nameOf } from '../lib/signer';
import { Addr, Ic, Link, MiniEmpty, Notice, Tx, ago } from '../ui/bits';
import { TokenLogo } from '../ui/logos';
import { Candles } from '../ui/Candles';

/** Hyperliquid-style market view: stats strip, depth and trades on the left, the order book on the right. */
export function Markets({ sym }: { sym?: string }) {
  const m = MARKETS.find(x => x.symbol === (sym ?? 'AVAX').toUpperCase()) ?? MARKETS[0];
  const mk = useLive(() => readMarkets(), [], 5000);
  const book = useLive(() => readBook(m.id, 12), [m.id], 3000);
  const fills = useLive(() => recentFills(4000n), [], 15_000);
  const s = mk.data?.[m.id];
  const dp = m.id === 1 ? 0 : 3;
  const sdp = m.sizeDp;

  return <div className="markets">
    <div className="mk-tabs" role="tablist" aria-label="Markets">
      {MARKETS.map(x => <Link key={x.id} to={`/markets/${x.symbol}`} className="mk-tab" aria-current={x.id === m.id ? 'page' : undefined}><TokenLogo sym={x.symbol} size={24} />{x.pair}<span className="mono">{mk.data ? `$${fmtPrice(mk.data[x.id]!.oracle, x.id === 1 ? 0 : 3)}` : ''}</span></Link>)}
    </div>
    {mk.error && !mk.data && <Notice error>Could not read the venue on Fuji: {mk.error}</Notice>}
    <section className="mk-strip" aria-label={`${m.pair} stats`}>
      <div className="mk-id"><TokenLogo sym={m.symbol} size={44} /><div><h1>{m.pair}</h1><span className="faint">Perpetual · margin in tUSDC</span></div></div>
      <Stat label="Chainlink" v={s ? `$${fmtPrice(s.oracle, dp + 1)}` : '…'} sub={s ? (s.stale ? 'stale: trading paused' : `updated ${ago(s.oracleAt)}`) : ''} bad={s?.stale} />
      <Stat label="Best bid / ask" v={s ? `${s.bestBid ? fmtPrice(s.bestBid, dp) : '–'} / ${s.bestAsk ? fmtPrice(s.bestAsk, dp) : '–'}` : '…'} sub={s && s.bestBid && s.bestAsk ? `spread ${(Number((s.bestAsk - s.bestBid) * 1_000_000n / s.oracle) / 100).toFixed(2)} bps` : 'one-sided book'} />
      <Stat label="Last fill" v={s?.lastPrice ? `$${fmtPrice(s.lastPrice, dp)}` : 'none yet'} sub={s ? `${s.tradeCount.toString()} fills on-chain` : ''} />
      <Stat label="Funding / hour" v={s ? `${(Number(s.hourlyRate) / 1e16).toFixed(4)}%` : '…'} sub={s ? `premium ${(Number(s.premium) / 1e16).toFixed(3)}% · ${Number(s.hourlyRate) >= 0 ? 'longs pay' : 'shorts pay'}` : ''} />
      <Stat label="Open interest" v={s ? `${fmtSize(s.openInterest, sdp)} ${m.symbol}` : '…'} sub={s ? `$${usd(s.openInterest * s.oracle / PX_SIZE, 0)}` : ''} />
    </section>

    <div className="mk-grid">
      <section className="card mk-depth" aria-label="Price and depth">
        <div className="card-head"><h3>Price</h3><span className="label">real candles, Chainlink mark and Kumi's own fills</span></div>
        {book.data ? <Candles symbol={m.symbol} dp={dp} trades={book.data.trades} oracle={s ? Number(s.oracle) / 1e8 : undefined} /> : <div className="skeleton" style={{ height: 300 }} />}
        <div className="card-head" style={{ marginTop: 18 }}><h3>Depth</h3><span className="label">cumulative size around the Chainlink price</span></div>
        {book.data ? <DepthChart bids={book.data.bids} asks={book.data.asks} oracle={s?.oracle ?? 0n} /> : <div className="skeleton" style={{ height: 220 }} />}
        <div className="card-head" style={{ marginTop: 18 }}><h3>Recent fills</h3><span className="label">from the venue's on-chain ring buffer</span></div>
        {book.data && book.data.trades.length === 0 && <MiniEmpty obj="hourglass">No fills yet. A crew vote or a taker order will print here.</MiniEmpty>}
        {book.data && book.data.trades.length > 0 && <>
          <TradeSpark trades={book.data.trades} />
          <table className="table mk-trades"><thead><tr><th>Price</th><th className="num">Size</th><th className="num">Time</th></tr></thead><tbody>
            {book.data.trades.slice(0, 12).map((t, i) => <tr key={i}><td className={t.takerBuy ? 'up mono' : 'down mono'}>{fmtPrice(t.price, dp)}</td><td className="num">{fmtSize(t.size, sdp)}</td><td className="num faint">{ago(t.ts)}</td></tr>)}
          </tbody></table>
        </>}
      </section>

      <section className="card mk-book" aria-label="Order book">
        <div className="card-head"><h3>Order book</h3><span className="chip chip-mint chip-live"><span className="dot" />on-chain</span></div>
        {book.error && !book.data && <Notice error>{book.error}</Notice>}
        {book.data ? <Ladder bids={book.data.bids} asks={book.data.asks} dp={dp} sdp={sdp} s={s} /> : <div className="skeleton" style={{ height: 420 }} />}
      </section>
    </div>

    <div className="mk-grid2">
      <section className="card" aria-label="Fills with transactions">
        <div className="card-head"><h3>Fills on Snowtrace</h3><span className="label">Filled events, last ~2 h</span></div>
        {fills.error && !fills.data && <Notice error>{fills.error}</Notice>}
        {fills.data && fills.data.filter(f => f.market === m.id).length === 0 && <MiniEmpty obj="hourglass">No {m.pair} fills in the last few thousand blocks.</MiniEmpty>}
        <ul className="txlist">{(fills.data ?? []).filter(f => f.market === m.id).slice(-10).reverse().map(f => <li key={`${f.hash}-${f.makerOrderId}`}>
          <span className="what"><i className={`ic ${f.takerBuy ? 'tone-mint' : 'tone-pink'}`} /><span><b>{nameOf(f.taker!)}</b> {f.takerBuy ? 'bought' : 'sold'} {fmtSize(f.size!, sdp)} {m.symbol} @ ${fmtPrice(BigInt(f.price!), dp)} from {nameOf(f.maker!)}</span></span>
          <Tx hash={f.hash} />
        </li>)}</ul>
      </section>
      <section className="card" aria-label="Market rules">
        <div className="card-head"><h3>Market rules</h3></div>
        <ul className="rules-list">
          <li>Priced by Chainlink <a className="hash" href={addressUrl(m.feed)} target="_blank" rel="noreferrer">{m.pair} feed</a> (heartbeat {m.heartbeat >= 3600 ? `${m.heartbeat / 3600} h` : `${m.heartbeat / 60} min`}, 1% deviation). Older than {m.maxAge >= 3600 ? `${(m.maxAge / 3600).toFixed(0)} h` : `${m.maxAge / 60} min`} and every trade and liquidation reverts.</li>
          <li>Orders must sit within <b>{s ? s.bandBps / 100 : 5}%</b> of Chainlink, so the book can't be pushed far from the oracle.</li>
          <li>Initial margin <b>{s ? s.imBps / 100 : 10}%</b> (10x max), maintenance <b>{s ? s.mmBps / 100 : 5}%</b>; below it anyone can liquidate through the book for a 1% fee.</li>
          <li>Funding: book mid vs Chainlink, capped at ±1%, paid over 8 h, accrued every second.</li>
          <li>Tick ${m.id === 1 ? '1' : '0.001'}, lot {m.id === 1 ? '0.00001 BTC' : '0.01 AVAX'}. Price-time priority, self-trades cancel the resting order.</li>
        </ul>
        <p className="fine">Venue <Addr a={PERPS} label="KumiPerps" /> · liquidity from Kumi's maker bot account</p>
      </section>
    </div>
  </div>;
}

function Stat({ label, v, sub, bad }: { label: string; v: string; sub?: string; bad?: boolean }) {
  return <div className="mk-stat"><span className="label">{label}</span><b className="mono">{v}</b>{sub && <small className={bad ? 'down' : 'faint'}>{sub}</small>}</div>;
}

type Lvl = { price: bigint; size: bigint; count: number };
function Ladder({ bids, asks, dp, sdp, s }: { bids: Lvl[]; asks: Lvl[]; dp: number; sdp: number; s?: MarketState }) {
  // Bars show cumulative depth from the touch outwards; a level whose size changed since the last read flashes once.
  const seen = useRef(new Map<string, bigint>());
  const cum = (ls: Lvl[]) => { let t = 0n; return ls.map(l => (t += l.size)); };
  const bc = cum(bids), ac = cum(asks);
  const max = [...bc, ...ac].reduce((a, v) => (v > a ? v : a), 1n);
  const changed = new Set<string>();
  for (const [side, ls] of [['bid', bids], ['ask', asks]] as const) for (const l of ls) {
    const k = `${side}${l.price}`;
    const prev = seen.current.get(k);
    if (prev !== undefined && prev !== l.size) changed.add(k);
    seen.current.set(k, l.size);
  }
  const row = (l: Lvl, side: 'bid' | 'ask', total: bigint) => <div key={`${side}${l.price}:${changed.has(`${side}${l.price}`) ? l.size : ''}`} className={`lvl ${side} ${changed.has(`${side}${l.price}`) ? 'flash' : ''}`} title={`${l.count} order${l.count === 1 ? '' : 's'}`}>
    <i style={{ width: `${Number(total * 1000n / max) / 10}%` }} />
    <span className="mono p">{fmtPrice(l.price, dp)}</span><span className="mono">{fmtSize(l.size, sdp)}</span><span className="mono faint">{fmtSize(total, Math.min(sdp, 2))}</span>
  </div>;
  if (!bids.length && !asks.length) return <MiniEmpty obj="empty">The book is empty. Start the maker bot: <span className="mono">pnpm --filter @kumi-avax/scripts maker</span>.</MiniEmpty>;
  return <div className="ladder">
    <div className="lvl head"><span>Price</span><span>Size</span><span>Total</span></div>
    {asks.map((l, i) => ({ l, t: ac[i]! })).reverse().map(({ l, t }) => row(l, 'ask', t))}
    <div className="spread-row"><span className="mono">{s ? `$${fmtPrice(s.oracle, dp + 1)}` : ''}</span><span className="faint">Chainlink</span>{bids[0] && asks[0] && <span className="faint mono">spread {fmtPrice(asks[0].price - bids[0].price, dp + 1)}</span>}</div>
    {bids.map((l, i) => row(l, 'bid', bc[i]!))}
  </div>;
}

function DepthChart({ bids, asks, oracle }: { bids: Lvl[]; asks: Lvl[]; oracle: bigint }) {
  const d = useMemo(() => {
    if (!bids.length && !asks.length) return null;
    const pts = (ls: Lvl[]) => { let c = 0; return ls.map(l => { c += Number(l.size) / 1e18; return { x: Number(l.price) / 1e8, y: c }; }); };
    const b = pts(bids), a = pts(asks);
    const xs = [...b, ...a].map(p => p.x);
    const lo = Math.min(...xs), hi = Math.max(...xs);
    const ymax = Math.max(1e-9, ...b.map(p => p.y), ...a.map(p => p.y));
    const W = 640, H = 220, pad = 8;
    const X = (x: number) => pad + ((x - lo) / (hi - lo || 1)) * (W - pad * 2);
    const Y = (y: number) => H - 24 - (y / ymax) * (H - 40);
    const path = (ps: { x: number; y: number }[], dir: 1 | -1) => {
      if (!ps.length) return '';
      let s = `M${X(ps[0]!.x)},${Y(0)}`;
      let prevY = 0;
      for (const p of ps) { s += ` L${X(p.x)},${Y(prevY)} L${X(p.x)},${Y(p.y)}`; prevY = p.y; }
      s += ` L${dir > 0 ? W - pad : pad},${Y(prevY)} L${dir > 0 ? W - pad : pad},${Y(0)} Z`;
      return s;
    };
    return { W, H, bid: path(b, -1), ask: path(a, 1), ox: X(Number(oracle) / 1e8), lo, hi, Y0: Y(0) };
  }, [bids, asks, oracle]);
  if (!d) return <MiniEmpty obj="empty">No resting orders.</MiniEmpty>;
  return <svg className="depth" viewBox={`0 0 ${d.W} ${d.H}`} role="img" aria-label="Order book depth: bids left, asks right">
    <path d={d.bid} className="d-bid" /><path d={d.ask} className="d-ask" />
    {oracle > 0n && <><line x1={d.ox} x2={d.ox} y1={8} y2={d.Y0} className="d-oracle" /><text x={d.ox + 6} y={20} className="d-label">Chainlink</text></>}
    <text x={8} y={d.H - 6} className="d-axis">{d.lo.toFixed(d.lo > 1000 ? 0 : 3)}</text>
    <text x={d.W - 8} y={d.H - 6} className="d-axis" textAnchor="end">{d.hi.toFixed(d.hi > 1000 ? 0 : 3)}</text>
  </svg>;
}

function TradeSpark({ trades }: { trades: { price: bigint; ts: number; takerBuy: boolean }[] }) {
  const pts = [...trades].reverse();
  const ys = pts.map(t => Number(t.price));
  const lo = Math.min(...ys), hi = Math.max(...ys);
  const W = 640, H = 70;
  const d = pts.map((t, i) => `${i ? 'L' : 'M'}${(i / Math.max(1, pts.length - 1)) * W},${H - 6 - ((Number(t.price) - lo) / (hi - lo || 1)) * (H - 12)}`).join(' ');
  return <svg className="spark trade-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Price of the last fills"><path d={d} /></svg>;
}

export const MarketsIcon = () => <Ic name="book" />;
