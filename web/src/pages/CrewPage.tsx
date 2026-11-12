import type { Address } from 'viem';
import { DEPLOYMENT, Kind, MARKETS, usd, size as fmtSize, price as fmtPrice, signedUsd } from '@kumi-avax/sdk';
import { readCrew, readMarkets, readProposal, useLive } from '../lib/chain';
import { nameOf } from '../lib/signer';
import { Addr, Avatar, CrewAvatar, Ic, Link, MiniEmpty, Notice, Obj, ago, memberHue } from '../ui/bits';
import { pps, retPct } from '../ui/Fund';
import { TokenLogo } from '../ui/logos';

/** The public fund page: NAV, return, positions, every pitch and its result, members, rules and contracts. */
export function CrewPage({ address }: { address?: string }) {
  const crew = (address ?? DEPLOYMENT.crews[0]?.address) as Address | undefined;
  const st = useLive(() => (crew ? readCrew(crew) : Promise.reject(Error('No crew deployed'))), [crew], 8000);
  const mk = useLive(() => readMarkets(), [], 10_000);
  const n = st.data?.proposalCount ?? 0;
  const props = useLive(async () => crew ? Promise.all(Array.from({ length: n }, (_, i) => readProposal(crew, i))) : [], [crew, n, st.data?.readAt], 0);
  if (!crew) return <div className="page"><Notice error>No crew is deployed on this venue yet.</Notice></div>;
  if (st.error && !st.data) return <div className="page"><Notice error>Could not read crew {crew} on Fuji: {st.error}</Notice></div>;
  if (!st.data) return <div className="page"><div className="skeleton" style={{ height: 320 }} /></div>;
  const s = st.data;
  const ret = retPct(s);
  const exposure = s.positions.reduce((a, p) => a + p.notional, 0n);
  const trades = (props.data ?? []).filter(p => p.kind === Kind.Open || p.kind === Kind.Close).reverse();
  const realised = (props.data ?? []).filter(p => p.kind === Kind.Close && p.executed).reduce((a, p) => a + p.resultPnl, 0n);

  return <div className="page crew-page">
    <div className="page-head">
      <div className="row" style={{ gap: 16, alignItems: 'center' }}>
        <CrewAvatar address={s.address} name={s.name} size="lg" />
        <div><span className="label">Crew fund · Avalanche Fuji</span><h1>{s.name}</h1><p>{s.members.length} members trading perps by vote. Captain {nameOf(s.captain) || 'none'}.</p></div>
      </div>
      <div className="row"><Link to={`/room?crew=${s.address}`} className="btn btn-primary"><Ic name="chat" size={16} />Open the chat</Link><Link to="/markets" className="btn"><Ic name="book" size={16} />Markets</Link></div>
    </div>

    <div className="crew-grid">
      <div className="stack">
        <section className="hero-card fund-hero">
          <div className="row-between"><span className="label">Net asset value</span><span className="verify"><i />Read from KumiPerps</span></div>
          <div className="big">{usd(s.nav)} <small>tUSDC</small></div>
          <div className="row" style={{ flexWrap: 'wrap' }}><span className={`ret ${ret < 0 ? 'neg' : ''}`}>{ret >= 0 ? '+' : ''}{ret.toFixed(2)}%</span><span className="sub">${(Number(pps(s)) / 1e6).toFixed(4)} a share, from $1.0000</span></div>
          <div className="hero-stats">
            <span><small>Chipped in</small><b>${usd(s.totalDeposited, 0)}</b></span>
            <span><small>Paid out</small><b>${usd(s.totalWithdrawn, 0)}</b></span>
            <span><small>Realised PnL</small><b className={realised >= 0n ? 'pos' : 'neg'}>{signedUsd(realised)}</b></span>
            <span><small>Exposure</small><b>${usd(exposure, 0)}</b></span>
          </div>
        </section>

        <section className="card" aria-label="Trade history">
          <div className="card-head"><h3>Every pitch</h3><span className="label">{trades.length} trades voted on-chain</span></div>
          {props.data && trades.length === 0 && <MiniEmpty obj="vote">No trades pitched yet.</MiniEmpty>}
          {!props.data && n > 0 && <div className="skeleton" style={{ height: 160 }} />}
          {trades.length > 0 && <div className="table-wrap"><table className="table">
            <thead><tr><th>#</th><th>Trade</th><th>By</th><th className="num">Yes</th><th className="num">Fill</th><th className="num">Result</th></tr></thead>
            <tbody>{trades.map(p => {
              const m = MARKETS[p.market]!;
              const expired = !p.executed && Date.now() / 1000 > Number(p.deadline);
              const yes = s.totalShares > 0n ? Number(p.yesShares * 10000n / s.totalShares) / 100 : 0;
              return <tr key={p.id}>
                <td className="mono faint">{p.id}</td>
                <td><span className="row" style={{ gap: 8 }}><TokenLogo sym={m.symbol} size={22} /><b>{p.kind === Kind.Open ? `${p.isLong ? 'Long' : 'Short'} ${m.symbol} ${p.leverage}x · ${p.sizeBps / 100}%` : `Close ${m.symbol}${p.sizeBps < 10000 ? ` ${p.sizeBps / 100}%` : ''}`}</b></span></td>
                <td>{nameOf(p.proposer)}</td>
                <td className="num">{yes.toFixed(1)}%</td>
                <td className="num">{p.executed ? `${fmtSize(p.filled, m.sizeDp)} @ ${fmtPrice(BigInt(p.avgPrice), m.priceDp === 0 ? 0 : 3)}` : '–'}</td>
                <td className="num">{p.executed ? (p.kind === Kind.Close ? <b className={p.resultPnl >= 0n ? 'up' : 'down'}>{signedUsd(p.resultPnl)}</b> : <span className="st3 st3-mint">Opened</span>) : expired ? <span className="st3 st3-pink">Expired</span> : <span className="st3 st3-butter">Voting</span>}</td>
              </tr>;
            })}</tbody>
          </table></div>}
        </section>
      </div>

      <div className="stack">
        <section className="card" aria-label="Positions">
          <div className="card-head"><h3>Open positions</h3><span className="chip chip-mint chip-live"><span className="dot" />Live</span></div>
          {s.positions.length === 0 && <MiniEmpty obj="rocket">Flat. The crew holds only tUSDC margin right now.</MiniEmpty>}
          {s.positions.map(p => {
            const m = MARKETS[p.market]!;
            const pnl = p.unrealized - p.fundingOwed;
            return <div key={p.market} className="holding">
              <TokenLogo sym={m.symbol} size={38} />
              <div style={{ minWidth: 0 }}><div className="n">{m.symbol} {p.size > 0n ? 'long' : 'short'}</div><div className="s">{fmtSize(p.size > 0n ? BigInt(p.size) : -BigInt(p.size), m.sizeDp)} @ ${fmtPrice(BigInt(p.entry), m.priceDp === 0 ? 0 : 3)} · Chainlink ${fmtPrice(p.mark, m.priceDp === 0 ? 0 : 3)}</div></div>
              <div className="amt"><span className={pnl >= 0n ? 'up' : 'down'}>{signedUsd(pnl)}</span><div>${usd(p.notional, 0)}</div></div>
            </div>;
          })}
          {mk.data?.some(x => x.stale) && <p className="fine down">A Chainlink feed is stale; trading in that market is paused.</p>}
        </section>
        <section className="card" aria-label="Members">
          <div className="card-head"><h3>Members</h3><span className="label">non-transferable shares</span></div>
          <div className="alloc">{s.members.map(m => <span key={m.address} style={{ flex: Number(m.shares / 10n ** 12n) || 0.0001, background: memberHue(m.address) }} />)}</div>
          {s.members.map(m => <div key={m.address} className="member"><Avatar id={m.address} /><div><div className="n">{nameOf(m.address)}</div><div className="s"><Addr a={m.address} /></div></div><div className="share" style={{ ['--tone' as string]: memberHue(m.address) }}>{s.totalShares > 0n ? (Number(m.shares * 10000n / s.totalShares) / 100).toFixed(1) : '0.0'}%<i><b style={{ width: `${s.totalShares > 0n ? Number(m.shares * 100n / s.totalShares) : 0}%` }} /></i></div></div>)}
        </section>
        <section className="card" aria-label="Contracts">
          <div className="card-head"><h3>On-chain</h3><Obj name="shield" size={48} /></div>
          <ul className="rules-list">
            <li>Crew vault <Addr a={s.address} /></li>
            <li>Order book venue <Addr a={DEPLOYMENT.perps} /></li>
            <li>Test dollar <Addr a={DEPLOYMENT.usdc} label="tUSDC" /></li>
            <li>Factory <Addr a={DEPLOYMENT.factory} /></li>
          </ul>
          <p className="fine">Refreshed {ago(Math.floor(s.readAt / 1000))}</p>
        </section>
      </div>
    </div>
  </div>;
}
