import { useEffect, useState } from 'react';
import type { Address } from 'viem';
import QRCode from 'qrcode';
import { DEPLOYMENT, MARKETS, usd, price as fmtPrice, size as fmtSize, PX_SIZE, gasStationAbi, usdcAbi, readChannels } from '@kumi-avax/sdk';
import { latestFills, pub, readBook, readCrew, readMarkets, useLive } from '../lib/chain';
import { nameOf } from '../lib/signer';
import { Addr, Art, Ic, Link, Notice, Obj, Tx } from '../ui/bits';
import { retPct } from '../ui/Fund';
import { AvaxMark, TokenLogo } from '../ui/logos';

/** The phone build of the same app (Expo web export), for people without a simulator. */
export const PHONE_WEB = 'https://kumi-avax-app.vercel.app';

type Manifest = {
  ios?: { file: string; bytes: number; sha256: string; version: string; built: string };
  expo?: { url: string | null };
};

/** Counts that prove the claims below, read from Fuji on every visit. */
async function readProof() {
  const eerc = DEPLOYMENT.eerc?.encryptedERC as Address | undefined;
  const station = DEPLOYMENT.gasStation as Address | null;
  const [channels, shielded, drips] = await Promise.all([
    readChannels(pub, DEPLOYMENT.lobby as Address),
    eerc ? pub.readContract({ address: DEPLOYMENT.usdc as Address, abi: usdcAbi, functionName: 'balanceOf', args: [eerc] }) : Promise.resolve(null),
    station ? pub.readContract({ address: station, abi: gasStationAbi, functionName: 'totalDrips' }) : Promise.resolve(null),
  ]);
  return {
    messages: channels.reduce((a, c) => a + c.messageCount, 0),
    members: channels.reduce((a, c) => a + c.memberCount, 0),
    shielded: shielded as bigint | null,
    drips: drips === null ? null : Number(drips),
  };
}

const mb = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)} MB`;
const scrollToApp = (e: React.MouseEvent) => { e.preventDefault(); document.getElementById('get-app')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };

export function Landing() {
  const crew = DEPLOYMENT.crews[0]?.address as Address | undefined;
  const st = useLive(() => (crew ? readCrew(crew) : Promise.reject(Error('no crew'))), [crew], 15_000);
  const mk = useLive(() => readMarkets(), [], 15_000);
  const book = useLive(() => readBook(0, 4), [], 15_000);
  const fills = useLive(() => latestFills(6), [], 120_000);
  const proof = useLive(() => readProof(), [], 30_000);
  const avax = mk.data?.[0];
  const oi = (mk.data ?? []).reduce((a, m) => a + m.openInterest * m.oracle / PX_SIZE, 0n);
  const lastPitch = st.data?.feed.filter(f => f.kind === 1).at(-1);
  const ret = st.data ? retPct(st.data) : 0;
  const tradeCount = mk.data ? mk.data.reduce((a, m) => a + Number(m.tradeCount), 0) : null;

  return <div className="landing">
    <section className="l-hero">
      <div className="l-hero-in">
        <div>
          <span className="kicker"><b>APP</b>For friends who trade together</span>
          <h1>Your group chat is a <em>fund</em>.</h1>
          <p className="lead">Pitch a trade in the chat. Your crew votes, and the crew fund trades it. Leave anytime with your exact share.</p>
          <div className="l-cta">
            <a href="#get-app" onClick={scrollToApp} className="btn btn-primary btn-lg">Get the app <Ic name="arrow" /></a>
            <Link to="/room" className="btn btn-lg">Try it on the web</Link>
          </div>
          <p className="l-why"><AvaxMark size={18} /><span>On Avalanche: trades settle in about two seconds for a fraction of a cent.</span></p>
        </div>
        <div className="l-art">
          <Art name={['kumi3-hero', 'kumi-hero']} alt="The Kumi crew, four clay animals around a phone" eager />
          {st.data && <div className="l-float f1 tone-butter"><span className="ic"><Ic name="jar" size={18} /></span><span><b>${usd(st.data.nav)}</b>{st.data.name} fund · {ret >= 0 ? '+' : ''}{ret.toFixed(2)}%</span></div>}
          {avax && <div className="l-float f2 tone-mint"><span className="ic"><TokenLogo sym="AVAX" size={26} /></span><span><b>${fmtPrice(avax.oracle, 3)}</b>AVAX · Chainlink on Fuji</span></div>}
        </div>
      </div>
    </section>

    <section className="l-stats" aria-label="Live on Fuji">
      <div className="l-stat tone-coral"><span className="label">Crew fund</span><div className="v">{st.data ? `$${usd(st.data.nav, 0)}` : '…'}</div><div className="s">{st.data ? `${st.data.members.length} members, ${st.data.proposalCount} pitches` : 'reading Fuji'}</div></div>
      <div className="l-stat tone-butter"><span className="label">Open interest</span><div className="v">{mk.data ? `$${usd(oi, 0)}` : '…'}</div><div className="s">AVAX-USD and BTC-USD</div></div>
      <div className="l-stat tone-mint"><span className="label">Fills on-chain</span><div className="v">{tradeCount ?? '…'}</div><div className="s">matched by the contract</div></div>
      <div className="l-stat tone-pink"><span className="label">Chat messages</span><div className="v">{proof.data ? proof.data.messages : '…'}</div><div className="s">in public chats, all on Fuji</div></div>
    </section>
    {(st.error && !st.data) && <div className="l-sec" style={{ paddingTop: 24 }}><Notice error>Could not read the crew on Fuji: {st.error}</Notice></div>}

    <section className="l-sec" aria-labelledby="how">
      <div className="l-head"><h2 id="how">How it works</h2><p>Three steps, all in the chat.</p></div>
      <div className="flow">
        <article className="flow-row">
          <Obj name="chat" size={96} />
          <div><h3>Pitch it</h3><p>Type <code>/long AVAX 3x 20%</code>. It becomes a trade card with today's numbers.</p></div>
          <div className="flow-live">{lastPitch ? <><span className="label">Latest pitch</span><b className="mono">{lastPitch.text || `#${lastPitch.ref}`}</b><span className="faint">by {nameOf(lastPitch.who)}</span></> : <span className="faint">{st.data ? 'No pitches yet' : 'Reading Fuji…'}</span>}</div>
        </article>
        <article className="flow-row">
          <Obj name="vote" size={96} />
          <div><h3>Vote, and it trades</h3><p>Members vote with their shares. The deciding vote places the order on Kumi's on-chain order book.</p></div>
          <div className="flow-live mini-book">{book.data ? <>
            {[...book.data.asks].slice(0, 3).reverse().map(l => <span key={`a${l.price}`} className="down mono">{fmtPrice(l.price, 3)} <small>{fmtSize(l.size, 1)}</small></span>)}
            <span className="faint mono">AVAX book now</span>
            {book.data.bids.slice(0, 3).map(l => <span key={`b${l.price}`} className="up mono">{fmtPrice(l.price, 3)} <small>{fmtSize(l.size, 1)}</small></span>)}
          </> : <span className="faint">Reading the book…</span>}</div>
        </article>
        <article className="flow-row">
          <Obj name="door" size={96} />
          <div><h3>Leave anytime</h3><p>Take your exact share, even while a trade is open. Everyone else keeps theirs.</p></div>
          <div className="flow-live"><span className="label">Tested on Fuji</span><b className="mono">left mid-trade</b><span className="faint">share price unchanged for the rest</span></div>
        </article>
      </div>
    </section>

    <section className="l-sec" aria-labelledby="pp">
      <div className="l-head"><h2 id="pp">Private where it counts</h2><p>Tips stay between friends. Everything else is on the record.</p></div>
      <div className="pp-grid">
        <article className="pp-card">
          <div className="pp-art"><Art name="kumi5-private" alt="A sealed coral envelope with a heart wax seal and a small plum padlock" /></div>
          <div className="pp-body">
            <h3>Private</h3>
            <p>Tips and paybacks between friends. Only the sender, the receiver and Kumi's auditor can read the amount, using Ava Labs' encrypted ERC.</p>
            <div className="pp-nums">
              <div className="flow-live"><span className="label">Held privately</span><b className="mono">{proof.data?.shielded != null ? `${usd(proof.data.shielded, 0)} tUSDC` : proof.error ? '—' : '…'}</b><span className="faint">balances hidden</span></div>
              <div className="flow-live"><span className="label">Contract</span><b className="mono">{DEPLOYMENT.eerc ? <Addr a={DEPLOYMENT.eerc.encryptedERC} label="EncryptedERC" /> : '—'}</b><span className="faint">open on Snowtrace</span></div>
            </div>
          </div>
        </article>
        <article className="pp-card">
          <div className="pp-art"><Art name="kumi5-proof" alt="An owl in butter glasses checking a receipt with a magnifying glass" /></div>
          <div className="pp-body">
            <h3>Proven</h3>
            <p>Every message, vote, fill and payout is a Fuji transaction. A copied call is checked against the order book before it posts.</p>
            <div className="pp-nums">
              <div className="flow-live"><span className="label">Fills</span><b className="mono">{tradeCount ?? '…'}</b><span className="faint">on KumiPerps</span></div>
              <div className="flow-live"><span className="label">New wallets</span><b className="mono">{proof.data?.drips ?? (proof.error ? '—' : '…')}</b><span className="faint">first gas from Kumi</span></div>
            </div>
          </div>
        </article>
      </div>
      {proof.error && !proof.data && <div style={{ marginTop: 12 }}><Notice error>Could not read Fuji: {proof.error}</Notice></div>}
    </section>

    <GetApp />

    <section className="l-sec" aria-labelledby="proof">
      <div className="l-head"><h2 id="proof">Check it yourself</h2><p>Every contract is live on Avalanche Fuji. Open any of them on Snowtrace.</p></div>
      <div className="proof-grid">
        <div className="card"><ul className="txlist contracts">
          <li><span className="what"><Obj name="rocket" size={34} still /><span><b>Order book</b> KumiPerps</span></span><Addr a={DEPLOYMENT.perps} /></li>
          <li><span className="what"><Obj name="jar" size={34} still /><span><b>Crew funds</b> KumiCrewFactory</span></span><Addr a={DEPLOYMENT.factory} /></li>
          <li><span className="what"><Obj name="chat" size={34} still /><span><b>Public chats</b> KumiLobby</span></span><Addr a={DEPLOYMENT.lobby} /></li>
          {DEPLOYMENT.eerc && <li><span className="what"><Obj name="shield" size={34} still /><span><b>Private tips</b> EncryptedERC</span></span><Addr a={DEPLOYMENT.eerc.encryptedERC} /></li>}
          {DEPLOYMENT.gasStation && <li><span className="what"><Obj name="coins" size={34} still /><span><b>First gas</b> KumiGasStation</span></span><Addr a={DEPLOYMENT.gasStation} /></li>}
        </ul></div>
        <div className="card"><div className="card-head"><h3>Latest fills</h3><span className="chip chip-mint chip-live"><span className="dot" />Live</span></div><ul className="txlist">
          {(fills.data ?? []).map(f => <li key={`${f.hash}${f.makerOrderId}`}><span className="what"><i className={`ic ${f.takerBuy ? 'tone-mint' : 'tone-pink'}`} /><span><b>{nameOf(f.taker!)}</b> {f.takerBuy ? 'bought' : 'sold'} {fmtSize(f.size!, MARKETS[f.market!]!.sizeDp)} {MARKETS[f.market!]!.symbol} at ${fmtPrice(BigInt(f.price!), f.market === 1 ? 0 : 3)}</span></span><Tx hash={f.hash} /></li>)}
          {fills.data && fills.data.length === 0 && <li><span className="faint">No fills in the last 24 hours. The book is open on the markets page.</span></li>}
          {fills.error && !fills.data && <li><Notice error>Could not read fills: {fills.error}</Notice></li>}
          {!fills.data && !fills.error && <li><span className="skeleton" style={{ height: 40, width: '100%' }} /></li>}
        </ul></div>
      </div>
    </section>

    <footer className="footer"><span>Kumi on Avalanche · MIT · Fuji testnet, test dollars only.</span><span>Prior work: Kumi's crew rooms, chat commands, votes and art were first built for NEAR. The perps venue, vault and apps are new.</span></footer>
  </div>;
}

/** "Get the app": the iOS Simulator build, Expo Go (only once a real update URL exists) and the web builds. */
function GetApp() {
  const [m, setM] = useState<Manifest | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    fetch('/download/manifest.json', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : Promise.reject(Error(`manifest ${r.status}`))))
      .then((j: Manifest) => setM(j))
      .catch(e => setErr((e as Error).message));
  }, []);
  const expo = m?.expo?.url ?? null;
  useEffect(() => {
    if (!expo) return;
    QRCode.toDataURL(expo, { margin: 1, width: 360, color: { dark: '#2b1630', light: '#ffffff' } }).then(setQr).catch(() => setQr(null));
  }, [expo]);
  const ios = m?.ios;
  const install = ios ? `xcrun simctl install booted ${ios.file.replace(/-iOS-Simulator\.zip$/, '')}.app` : '';
  return <section className="l-sec" id="get-app" aria-labelledby="get-app-h">
    <div className="app-band">
      <div className="app-head">
        <div className="app-copy">
          <h2 id="get-app-h">Get the app</h2>
          <p>Kumi is a phone app. Your wallet lives on the phone, and your first gas is on Kumi.</p>
        </div>
        <div className="app-art"><Art name="kumi5-get-app" alt="A fox and a bunny hugging a plum phone full of chat bubbles" /></div>
      </div>
      <div className="app-opts">
          <div className="app-opt">
            <div className="app-opt-top"><span className="app-ic"><Ic name="external" size={18} /></span><div><b>iOS Simulator</b><small>{ios ? `On a Mac with Xcode · ${mb(ios.bytes)}` : err ? 'Download unavailable' : 'Loading…'}</small></div></div>
            {ios ? <>
              <a className="btn btn-primary" href={`/download/${ios.file}`} download>Download for iOS Simulator</a>
              <div className="app-cmd"><code>{install}</code><button className="btn btn-sm btn-ghost" onClick={() => { navigator.clipboard?.writeText(install).then(() => setCopied(true)).catch(() => {}); }}>{copied ? 'Copied' : 'Copy'}</button></div>
              <small className="app-sha" title={ios.sha256}>Unzip, open a simulator, run the line. v{ios.version}, SHA-256 <span className="mono">{ios.sha256.slice(0, 16)}…</span></small>
            </> : err ? <Notice error>Could not load the download list: {err}</Notice> : <span className="skeleton" style={{ height: 44 }} />}
          </div>
          <div className="app-opt">
            <div className="app-opt-top"><span className="app-ic"><Ic name="spark" size={18} /></span><div><b>Expo Go</b><small>Scan with your phone's camera</small></div></div>
            {expo && qr ? <div className="app-qr"><img src={qr} width={148} height={148} alt="QR code that opens Kumi in Expo Go" /><a href={expo} className="hash">{expo.replace(/^exp:\/\//, '')}</a></div>
              : <div className="app-setup"><b>Setup required</b><span>The Expo Go link appears here once the app is published.</span></div>}
          </div>
          <div className="app-opt">
            <div className="app-opt-top"><span className="app-ic"><Ic name="chat" size={18} /></span><div><b>In your browser</b><small>No install</small></div></div>
            <a className="btn btn-plum" href={PHONE_WEB} target="_blank" rel="noreferrer">Open the phone app</a>
            <Link to="/room" className="btn">Open the web app</Link>
          </div>
      </div>
    </div>
  </section>;
}
