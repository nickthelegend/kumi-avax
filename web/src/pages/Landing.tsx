import type { Address } from 'viem';
import { DEPLOYMENT, MARKETS, usd, price as fmtPrice, size as fmtSize, PX_SIZE } from '@kumi-avax/sdk';
import { readBook, readCrew, readMarkets, recentFills, useLive } from '../lib/chain';
import { nameOf } from '../lib/signer';
import { Addr, Art, Ic, Link, Notice, Obj, Tx } from '../ui/bits';
import { retPct } from '../ui/Fund';
import { AvaxMark, TokenLogo } from '../ui/logos';

export function Landing() {
  const crew = DEPLOYMENT.crews[0]?.address as Address | undefined;
  const st = useLive(() => (crew ? readCrew(crew) : Promise.reject(Error('no crew'))), [crew], 15_000);
  const mk = useLive(() => readMarkets(), [], 15_000);
  const book = useLive(() => readBook(0, 4), [], 15_000);
  const fills = useLive(() => recentFills(6000n), [], 30_000);
  const avax = mk.data?.[0];
  const oi = (mk.data ?? []).reduce((a, m) => a + m.openInterest * m.oracle / PX_SIZE, 0n);
  const lastPitch = st.data?.feed.filter(f => f.kind === 1).at(-1);
  const ret = st.data ? retPct(st.data) : 0;

  return <div className="landing">
    <section className="l-hero">
      <div className="l-hero-in">
        <div>
          <span className="kicker"><b>NEW</b>Crews now trade perps on Avalanche</span>
          <h1>Your group chat is a fund. Now it trades <em>perps</em>.</h1>
          <p className="lead">Type <code>/long AVAX 3x 20%</code>. The crew votes with its shares, and the vault opens the position on an on-chain order book. Anyone can leave with their exact share.</p>
          <div className="l-cta">
            <Link to="/room" className="btn btn-primary btn-lg">Open the crew room <Ic name="arrow" /></Link>
            <Link to="/markets" className="btn btn-lg">See the order book</Link>
          </div>
        </div>
        <div className="l-art">
          <Art name={['kumi3-hero', 'kumi-hero']} alt="The Kumi crew, four clay animals around a phone" eager />
          {st.data && <div className="l-float f1 tone-butter"><span className="ic"><Ic name="jar" size={18} /></span><span><b>${usd(st.data.nav)}</b>{st.data.name} NAV · {ret >= 0 ? '+' : ''}{ret.toFixed(2)}%</span></div>}
          {avax && <div className="l-float f2 tone-mint"><span className="ic"><TokenLogo sym="AVAX" size={26} /></span><span><b>${fmtPrice(avax.oracle, 3)}</b>AVAX · Chainlink on Fuji</span></div>}
        </div>
      </div>
    </section>

    <section className="l-stats" aria-label="Live on Fuji">
      <div className="l-stat tone-coral"><span className="label">Crew NAV</span><div className="v">{st.data ? `$${usd(st.data.nav, 0)}` : '…'}</div><div className="s">{st.data ? `${st.data.members.length} members, ${st.data.proposalCount} pitches` : 'reading Fuji'}</div></div>
      <div className="l-stat tone-butter"><span className="label">Open interest</span><div className="v">{mk.data ? `$${usd(oi, 0)}` : '…'}</div><div className="s">AVAX-USD and BTC-USD</div></div>
      <div className="l-stat tone-mint"><span className="label">Fills on-chain</span><div className="v">{mk.data ? mk.data.reduce((a, m) => a + Number(m.tradeCount), 0) : '…'}</div><div className="s">matched by the contract</div></div>
      <div className="l-stat tone-pink"><span className="label">Venue</span><div className="v"><AvaxMark size={26} /> Fuji</div><div className="s"><Addr a={DEPLOYMENT.perps} label="KumiPerps" /></div></div>
    </section>
    {(st.error && !st.data) && <div className="l-sec" style={{ paddingTop: 24 }}><Notice error>Could not read the crew on Fuji: {st.error}</Notice></div>}

    <section className="l-sec">
      <div className="l-head"><h2>One chat, one fund, one order book</h2><p>The NEAR version of Kumi let crews swap spot tokens. On Avalanche the crew trades perpetuals, and every step is a transaction you can open on Snowtrace.</p></div>
      <div className="flow">
        <article className="flow-row">
          <Obj name="chat" size={96} />
          <div><h3>Pitch it in the chat</h3><p>Commands become trade cards with today's numbers: margin, notional, size at the Chainlink price. Messages are on-chain too.</p></div>
          <div className="flow-live">{lastPitch ? <><span className="label">Latest pitch</span><b className="mono">{lastPitch.text || `#${lastPitch.ref}`}</b><span className="faint">by {nameOf(lastPitch.who)}</span></> : <span className="faint">No pitches yet</span>}</div>
        </article>
        <article className="flow-row">
          <Obj name="vote" size={96} />
          <div><h3>Vote with your shares</h3><p>Yes votes are counted from current shareholders. When they pass the threshold, the last vote executes the trade in the same transaction.</p></div>
          <div className="flow-live">{st.data ? <><span className="label">Threshold</span><b className="mono">{(st.data.policy.thresholdBps / 100).toFixed(2)}% of shares</b><span className="faint">crew cap {st.data.policy.maxLeverage}x leverage</span></> : null}</div>
        </article>
        <article className="flow-row">
          <Obj name="rocket" size={96} />
          <div><h3>Fills on a real order book</h3><p>Limit orders rest in the contract and match by price and time. Margin, funding and liquidations are marked to Chainlink.</p></div>
          <div className="flow-live mini-book">{book.data ? <>
            {[...book.data.asks].slice(0, 3).reverse().map(l => <span key={`a${l.price}`} className="down mono">{fmtPrice(l.price, 3)} <small>{fmtSize(l.size, 1)}</small></span>)}
            <span className="faint mono">— spread —</span>
            {book.data.bids.slice(0, 3).map(l => <span key={`b${l.price}`} className="up mono">{fmtPrice(l.price, 3)} <small>{fmtSize(l.size, 1)}</small></span>)}
          </> : null}</div>
        </article>
        <article className="flow-row">
          <Obj name="door" size={96} />
          <div><h3>Leave whenever, exactly</h3><p>Ragequit closes your slice of each open position and pays what it leaves. The members who stay keep exactly what they had per share.</p></div>
          <div className="flow-live"><span className="label">Tested</span><b className="mono">ragequit mid-position</b><span className="faint">remaining share price unchanged</span></div>
        </article>
      </div>
    </section>

    <section className="l-sec">
      <div className="l-head"><h2>Why Avalanche</h2><p>An order book and a group chat on-chain need blocks that land in about two seconds and cost almost nothing. Fuji gives both, and Chainlink publishes AVAX and BTC feeds on it.</p></div>
      <div className="tech">
        <div className="tech-item tone-coral"><Obj name="shield" size={52} /><h4>Chainlink price feeds</h4><p>AVAX/USD and BTC/USD on Fuji. A stale feed pauses trading instead of mispricing it.</p></div>
        <div className="tech-item tone-butter"><Obj name="hourglass" size={52} /><h4>Fast finality</h4><p>A vote, the fill and the PnL show up in the room a couple of seconds after the click.</p></div>
        <div className="tech-item tone-mint"><Obj name="coins" size={52} /><h4>Mainnet route researched</h4><p>Primit on C-Chain settles through Orderly. An adapter is tested on a mainnet fork; see the docs.</p></div>
      </div>
    </section>

    <section className="l-sec">
      <div className="l-head"><h2>Latest fills</h2><p>Straight from the venue's Filled events.</p></div>
      <div className="card"><ul className="txlist">
        {(fills.data ?? []).slice(-8).reverse().map(f => <li key={`${f.hash}${f.makerOrderId}`}><span className="what"><i className={`ic ${f.takerBuy ? 'tone-mint' : 'tone-pink'}`} /><span><b>{nameOf(f.taker!)}</b> {f.takerBuy ? 'bought' : 'sold'} {fmtSize(f.size!, MARKETS[f.market!]!.sizeDp)} {MARKETS[f.market!]!.symbol} at ${fmtPrice(BigInt(f.price!), f.market === 1 ? 0 : 3)}</span></span><Tx hash={f.hash} /></li>)}
        {fills.data && fills.data.length === 0 && <li><span className="faint">No fills in the last few hours of Fuji blocks.</span></li>}
        {!fills.data && <li><span className="skeleton" style={{ height: 40, width: '100%' }} /></li>}
      </ul></div>
    </section>

    <section className="cta-band"><div className="cta-in">
      <div className="cta-copy"><h2>Bring the crew</h2><p>Three test members are already in Night Owls on Fuji. Watch them pitch, vote and close with PnL.</p><Link to="/room" className="btn btn-primary btn-lg">Open the room <Ic name="arrow" /></Link></div>
      <div className="cta-art"><Art name={['kumi3-vote', 'kumi-feature-vote']} alt="" /></div>
    </div></section>
    <footer className="footer"><span>Kumi on Avalanche · MIT · Fuji testnet, test dollars only.</span><span>Prior work: Kumi's crew rooms, chat commands, votes and art were first built for NEAR. The perps venue, vault and this app are new.</span></footer>
  </div>;
}
