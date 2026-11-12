import { useEffect, useRef, useState } from 'react';
import type { Abi, Address } from 'viem';
import { crewAbi, DEPLOYMENT, FeedKind, Kind, MARKETS, PX_SIZE, describe, parseCommand, usd, size as fmtSize, price as fmtPrice, signedUsd, CAPTAIN_REF } from '@kumi-avax/sdk';
import { feedTx, readCrew, readCrews, readMarkets, readProposal, useLive, type CrewState, type MarketState, type Proposal } from '../lib/chain';
import { nameOf, useWho, write } from '../lib/signer';
import { Avatar, CrewAvatar, EmptyArt, Ic, Link, Notice, Tx, crewTone, navigate } from '../ui/bits';
import { ChipInSheet, FundPane, QuitSheet, retPct } from '../ui/Fund';
import { TradeCard } from '../ui/TradeCard';
import { TokenLogo } from '../ui/logos';
import { LobbyRoom, PublicChats } from './Lobby';
import { PrivateCard, PrivatePanel } from '../ui/Private';
import { privateTxOf } from '@kumi-avax/sdk/eerc';

const HINTS: [string, string][] = [['/long AVAX 3x 20%', 'coral'], ['/short BTC 2x 10%', 'pink'], ['/close AVAX', 'butter'], ['/captain long AVAX 2x 5%', 'mint']];
type Tab = 'crews' | 'chat' | 'fund';

export function Room() {
  const wanted = new URLSearchParams(location.search).get('crew');
  const crews = useLive(() => readCrews(), [], 30_000);
  const chat = new URLSearchParams(location.search).get('chat');
  if (chat && /^l-\d+$/.test(chat)) {
    const channel = Number(chat.slice(2));
    return <LobbyRoom key={chat} channel={channel} list={<aside className="pane list" aria-label="Chats">
      <div className="list-head"><div className="row-between"><h2>Crews</h2><Link to="/markets" className="chip chip-butter"><Ic name="book" size={13} />Markets</Link></div></div>
      <CrewList crews={crews.data ?? []} />
      <PublicChats current={channel} />
    </aside>} />;
  }
  const crew = (wanted ?? crews.data?.[0]?.address ?? DEPLOYMENT.crews[0]?.address) as Address | undefined;
  if (crews.error && !crews.data && !crew) return <div className="page"><Notice error>Could not read the Kumi crew factory on Fuji: {crews.error}</Notice></div>;
  if (!crew) return <div className="page"><div className="card"><EmptyArt art={['kumi3-empty', 'kumi-og']} title="No crews yet">Run <span className="mono">pnpm --filter @kumi-avax/scripts deploy</span> to create the first crew on Fuji.</EmptyArt></div></div>;
  return <CrewRoom key={crew} crew={crew} crews={crews.data ?? []} />;
}

/** The crews in the room's left list. */
function CrewList({ crews, current }: { crews: Awaited<ReturnType<typeof readCrews>>; current?: Address }) {
  return (
    <ul className="crew-list">
      {(crews.length ? crews : DEPLOYMENT.crews.map(c => ({ address: c.address as Address, name: c.name, nav: 0n, members: 0, totalShares: 0n }))).map(c => {
        const r = c.totalShares > 0n ? Number(c.nav * 10n ** 18n / c.totalShares - 1_000_000n) / 10_000 : 0;
        return <li key={c.address}>
          <a href={`/room?crew=${c.address}`} className={`crew-item tone-${crewTone(c.address)}`} aria-current={!!current && c.address.toLowerCase() === current.toLowerCase() ? 'page' : undefined} onClick={e => { e.preventDefault(); navigate(`/room?crew=${c.address}`); }}>
            <CrewAvatar address={c.address} name={c.name} />
            <span style={{ minWidth: 0 }}><span className="n" style={{ display: 'block' }}>{c.name}</span><span className="p" style={{ display: 'block' }}>{c.members} members · ${usd(c.nav, 0)} NAV</span></span>
            <span className="meta"><span className={`badge badge-ret ${r < 0 ? 'neg' : ''}`}>{r >= 0 ? '+' : ''}{r.toFixed(2)}%</span></span>
          </a>
        </li>;
      })}
    </ul>
  );
}

function CrewRoom({ crew, crews }: { crew: Address; crews: Awaited<ReturnType<typeof readCrews>> }) {
  const who = useWho();
  const [tab, setTab] = useState<Tab>('chat');
  const [sheet, setSheet] = useState<'chip' | 'quit' | null>(null);
  const st = useLive(() => readCrew(crew, who?.address), [crew, who?.address], 5000);
  const mk = useLive(() => readMarkets(), [], 5000);
  const pitchIds = (st.data?.feed ?? []).filter(f => f.kind === FeedKind.Pitch).map(f => f.ref).slice(-30);
  const props = useLive(async () => {
    const out: Record<number, Proposal> = {};
    await Promise.all(pitchIds.map(async id => { out[id] = await readProposal(crew, id, who?.address); }));
    return out;
  }, [crew, pitchIds.join(','), who?.address, st.data?.readAt], 0);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const stuck = useRef(true);
  const count = st.data?.feed.length ?? 0;
  useEffect(() => { const b = box.current; if (b && stuck.current) b.scrollTop = b.scrollHeight; }, [count, props.data, tab]);

  const refresh = () => { st.reload(); props.reload(); mk.reload(); };
  const pitch = (t: string) => { setTab('chat'); setText(t); requestAnimationFrame(() => input.current?.focus()); };
  const parsed = parseCommand(text, st.data?.policy.maxLeverage ?? 5);

  async function send() {
    const t = text.trim();
    if (!t || !st.data) return;
    if (parsed && !parsed.ok) { setErr(parsed.error); return; }
    setBusy(true); setErr(null); stuck.current = true;
    const z = '0x0000000000000000000000000000000000000000';
    try {
      const abi = crewAbi as Abi;
      if (!parsed) await write(crew, abi, 'say', [t]);
      else {
        const c = parsed.cmd;
        if (c.kind === 'open' && c.captain) await write(crew, abi, 'captainOpen', [c.market, c.isLong, c.leverage, c.sizeBps, describe(c)]);
        else if (c.kind === 'close' && c.captain) await write(crew, abi, 'captainClose', [c.market, describe(c)]);
        else if (c.kind === 'open') await write(crew, abi, 'pitch', [Kind.Open, c.market, c.isLong, c.leverage, c.sizeBps, z, describe(c)]);
        else if (c.kind === 'close') await write(crew, abi, 'pitch', [Kind.Close, c.market, false, 0, c.sizeBps, z, describe(c)]);
        else if (c.kind === 'invite') await write(crew, abi, 'pitch', [Kind.AddMember, 0, false, 0, 0, c.address, describe(c)]);
        else await write(crew, abi, 'pitch', [Kind.SetCaptain, 0, false, 0, 0, c.address ?? z, describe(c)]);
      }
      setText('');
      refresh();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  const list = <aside className="pane list" aria-label="Crews">
    <div className="list-head"><div className="row-between"><h2>Crews</h2><Link to="/markets" className="chip chip-butter"><Ic name="book" size={13} />Markets</Link></div></div>
    <CrewList crews={crews} current={crew} />
    <PublicChats />
    <div className="list-foot">
      {st.data && <FirstRun st={st.data} props={props.data ?? {}} onChip={() => setSheet('chip')} onPitch={() => pitch('/long AVAX 3x 20%')} />}
      <MarketsMini markets={mk.data} />
      <section className="legend" aria-label="What the colours mean"><h3>Reading the chat</h3><ul>
        <li className="tone-coral"><i /><span><b>Coral</b> long pitches and opens</span></li>
        <li className="tone-butter"><i /><span><b>Butter</b> votes and chip-ins</span></li>
        <li className="tone-mint"><i /><span><b>Mint</b> profits</span></li>
        <li className="tone-pink"><i /><span><b>Pink</b> ragequits and losses</span></li>
      </ul></section>
    </div>
  </aside>;

  if (st.error && !st.data) return <div className="page"><Notice error>Could not read crew {crew} on Fuji: {st.error}</Notice></div>;
  if (!st.data) return <div className="room" data-tab={tab}>{list}<section className="pane thread"><div className="skeleton" style={{ height: 220, margin: 24 }} /></section><aside className="pane fund"><div className="skeleton" style={{ height: 260 }} /></aside></div>;
  // After a signer switch, the last read still describes the previous account until the next refresh lands:
  // never show (or act on) someone else's stake.
  const meFresh = !who || st.data.me?.address.toLowerCase() === who.address.toLowerCase();
  const s = meFresh ? st.data : { ...st.data, me: null };
  const markets = mk.data ?? [];
  const ret = retPct(s);
  const member = !!s.me?.isMember;
  const loadingMe = !meFresh;

  return (
    <div className="room" data-tab={tab}>
      {list}
      <section className="pane thread" aria-label={`${s.name} chat`}>
        <div className="thread-head">
          <CrewAvatar address={s.address} name={s.name} />
          <div className="grow">
            <h1>{s.name}</h1>
            <div className="sub"><span className="live"><i />Live on Fuji</span>{s.members.length} members · {s.proposalCount} pitches</div>
          </div>
          <span className="avatars hide-sm">{s.members.map(m => <Avatar key={m.address} id={m.address} />)}</span>
          <button className="btn btn-sm btn-plum thread-tabs" onClick={() => setTab('fund')}><Ic name="chart" size={15} />${usd(s.nav, 0)} <span className={ret < 0 ? 'neg-s' : 'pos-s'}>{ret >= 0 ? '+' : ''}{ret.toFixed(1)}%</span></button>
        </div>
        <div className="messages" aria-live="polite" ref={box} onScroll={e => { const b = e.currentTarget; stuck.current = b.scrollHeight - b.scrollTop - b.clientHeight < 80; }}>
          {s.feed.length === 0 && <EmptyArt art={['kumi3-empty', 'kumi-feature-chat']} title="Quiet in here" action={member ? <button className="btn btn-primary" onClick={() => pitch('/long AVAX 3x 20%')}>Pitch the first trade</button> : undefined}>Chip in, then pitch a perp with <span className="mono">/long AVAX 3x 20%</span>.</EmptyArt>}
          {s.feed.map((f, i) => <Message key={f.index} f={f} prev={s.feed[i - 1]} st={s} markets={markets} props={props.data ?? {}} onDone={refresh} />)}
        </div>
        <div className="composer">
          {err && <div style={{ marginBottom: 10 }}><Notice error>{err}</Notice></div>}
          {loadingMe ? <div className="guest-bar"><p><b>Switching to {who?.label}…</b> reading their stake on Fuji.</p></div>
            : !who ? <div className="guest-bar"><p><b>Read-only.</b> Connect a wallet on Fuji to talk, pitch perps and vote.</p></div>
            : !member ? <div className="guest-bar"><p><b>You're a guest here.</b> Only {s.name} members post. A member can invite you with <span className="mono">/invite</span>.</p><Link to={`/crew/${s.address}`} className="btn btn-mint">See the fund</Link></div>
            : <>
              {parsed?.ok && <CommandPreview cmd={parsed.cmd} st={s} markets={markets} />}
              {parsed && !parsed.ok && <p className="cmd-err" role="status">{parsed.error}</p>}
              <div className="hints"><span className="lbl">Pitch:</span>{HINTS.map(([h, tone]) => <button key={h} className={`hint tone-${tone}`} onClick={() => pitch(h)}>{h}</button>)}</div>
              <form className="composer-box" onSubmit={e => { e.preventDefault(); void send(); }}>
                <input ref={input} value={text} onChange={e => { setText(e.target.value); setErr(null); }} placeholder={(s.me?.shares ?? 0n) > 0n ? 'Message the crew, or /long AVAX 3x 20%' : 'Say hi, then chip in to get a vote'} aria-label="Message" maxLength={280} disabled={busy} />
                <button className="send" aria-label="Send" disabled={busy || !text.trim()}>{busy ? <span className="spin" /> : <Ic name="send" size={19} />}</button>
              </form>
              <p className="composer-note">Every message is a Fuji transaction. Perps fill on Kumi's on-chain order book, margin in test USDC.</p>
            </>}
        </div>
      </section>
      <aside className="pane fund" aria-label="Crew fund">
        <FundPane st={s} markets={markets} loadingMe={loadingMe} onChipIn={() => setSheet('chip')} onQuit={() => setSheet('quit')} />
        {/* Always mounted (an open sheet must survive the 5 s crew refresh); the send button shows for members only. */}
        <PrivatePanel title="Settle up privately" where={who && s.members.some(m => m.address.toLowerCase() === who.address.toLowerCase()) ? { kind: 'send', crew } : undefined} choices={s.members.map(m => m.address).filter(a => a.toLowerCase() !== who?.address.toLowerCase())} />
      </aside>
      <nav className="tabs" aria-label="Sections">
        {([['crews', 'Crews', 'crews'], ['chat', 'Chat', 'chat'], ['fund', 'Fund', 'chart']] as const).map(([t, l, ic]) => <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}><Ic name={ic} size={19} />{l}</button>)}
      </nav>
      {sheet === 'chip' && meFresh && <ChipInSheet st={s} onClose={() => setSheet(null)} onDone={refresh} />}
      {sheet === 'quit' && meFresh && <QuitSheet st={s} markets={markets} onClose={() => setSheet(null)} onDone={refresh} />}
    </div>
  );
}

/** What the command in the composer will do, priced now. */
function CommandPreview({ cmd, st, markets }: { cmd: NonNullable<ReturnType<typeof parseCommand>> extends infer P ? P extends { ok: true; cmd: infer C } ? C : never : never; st: CrewState; markets: MarketState[] }) {
  if (cmd.kind === 'open') {
    const m = MARKETS[cmd.market]!;
    const o = markets[cmd.market]?.oracle ?? 0n;
    const margin = st.nav * BigInt(cmd.sizeBps) / 10000n;
    const notional = margin * BigInt(cmd.leverage);
    const sz = o > 0n ? notional * PX_SIZE / o : 0n;
    const lim = cmd.captain ? `captain lane, no vote (max ${st.policy.captainMaxLeverage}x, ${st.policy.captainMaxBps / 100}%)` : `goes to a vote · needs ${(st.policy.thresholdBps / 100).toFixed(2)}% of shares`;
    return <div className={`cmd-preview ${cmd.isLong ? '' : 'short'}`}><span><span className="k">{cmd.captain ? 'Captain trade' : 'Trade card'}</span><b>{cmd.isLong ? 'Long' : 'Short'} {m.symbol} {cmd.leverage}x · {cmd.sizeBps / 100}%{cmd.defaultedSize ? ' (default size)' : ''}</b></span><span className="mono">${usd(margin)} margin → ${usd(notional)} ≈ {fmtSize(sz, m.sizeDp)} {m.symbol}</span><span className="fine">{lim}</span></div>;
  }
  if (cmd.kind === 'close') {
    const p = st.positions.find(x => x.market === cmd.market);
    return <div className="cmd-preview"><span><span className="k">{cmd.captain ? 'Captain close' : 'Close vote'}</span><b>Close {cmd.sizeBps / 100}% of {MARKETS[cmd.market]!.symbol}</b></span><span className="mono">{p ? `${signedUsd(p.unrealized)} open PnL at Chainlink` : 'no open position in this market'}</span></div>;
  }
  return <div className="cmd-preview"><span><span className="k">Vote</span><b>{cmd.kind === 'invite' ? `Invite ${nameOf(cmd.address)}` : `Make ${cmd.address ? nameOf(cmd.address) : 'nobody'} captain`}</b></span></div>;
}

function MarketsMini({ markets }: { markets?: MarketState[] }) {
  return <Link to="/markets" className="mk-mini" aria-label="Markets">
    {(markets ?? []).map(m => <span key={m.id} className="mk-row"><TokenLogo sym={m.symbol} size={26} /><b>{m.pair}</b><span className="mono">${fmtPrice(m.oracle, m.id === 1 ? 0 : 3)}</span><small className={m.stale ? 'down' : 'faint'}>{m.stale ? 'stale' : 'Chainlink'}</small></span>)}
    {!markets && <span className="skeleton" style={{ height: 60, display: 'block' }} />}
    <span className="mk-foot">Order book, trades and funding <Ic name="arrow" size={14} /></span>
  </Link>;
}

/** The getting-started path, checked against chain state. */
function FirstRun({ st, props, onChip, onPitch }: { st: CrewState; props: Record<number, Proposal>; onChip: () => void; onPitch: () => void }) {
  const who = useWho();
  const me = st.me;
  const voted = !!who && Object.values(props).some(p => p.votes.some(v => v.voter.toLowerCase() === who.address.toLowerCase()));
  const pitched = !!who && Object.values(props).some(p => p.proposer.toLowerCase() === who.address.toLowerCase());
  const steps = [
    { label: 'Connect a wallet on Fuji', done: !!who },
    { label: `Be in ${st.name}`, done: !!me?.isMember },
    { label: 'Chip in tUSDC', done: (me?.shares ?? 0n) > 0n, act: onChip, cta: 'Chip in' },
    { label: 'Pitch a perp', done: pitched, act: onPitch, cta: 'Pitch /long AVAX 3x 20%' },
    { label: 'Vote on a pitch', done: voted },
  ];
  const now = steps.findIndex(s => !s.done);
  if (now === -1) return null;
  const done = steps.filter(s => s.done).length;
  const step = steps[now]!;
  return <section className="steps" aria-label="Getting started">
    <h3>Get into the crew</h3>
    <p>{done} of {steps.length} done · each step is a Fuji transaction</p>
    <div className="bar"><i style={{ width: `${(done / steps.length) * 100}%` }} /></div>
    <ol>{steps.map((s, i) => <li key={s.label} className={s.done ? 'done' : i === now ? 'now' : ''}><span className="n">{s.done ? '✓' : i + 1}</span>{s.label}</li>)}</ol>
    {step.act && <button className="btn btn-butter btn-block" onClick={step.act}>{step.cta} <Ic name="arrow" size={16} /></button>}
    {now === 1 && <p style={{ margin: '12px 0 0', color: '#eadcf0' }}>Crews are invite-only: a member pitches <span className="mono">/invite</span> and the crew votes you in.</p>}
  </section>;
}

type Item = CrewState['feed'][number];
function Message({ f, prev, st, markets, props, onDone }: { f: Item; prev?: Item; st: CrewState; markets: MarketState[]; props: Record<number, Proposal>; onDone: () => void }) {
  const who = useWho();
  const [hash, setHash] = useState<string>();
  const needsHash = f.kind !== FeedKind.Pitch && f.kind !== FeedKind.Executed && f.index >= st.feed.length + (st.feed[0]?.index ?? 0) - 40;
  useEffect(() => { if (needsHash) void feedTx(st.address, f.index, f.block).then(setHash).catch(() => undefined); }, [st.address, f.index, f.block, needsHash]);
  const day = new Date(f.ts * 1000).toDateString();
  const showDay = !prev || new Date(prev.ts * 1000).toDateString() !== day;
  const time = new Date(f.ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const mine = who?.address.toLowerCase() === f.who.toLowerCase();
  const name = mine ? 'You' : nameOf(f.who);
  const sharePct = (x: bigint) => (st.totalShares > 0n ? (Number(x * 10000n / st.totalShares) / 100).toFixed(1) : '0');
  const p = props[f.ref];
  let body: React.ReactNode = null;
  const ev = (tone: string, ic: string, content: React.ReactNode) => <div className={`event tone-${tone}`} data-feed={f.kind}><span className="ev-ic"><Ic name={ic} size={14} /></span>{content}{hash && <Tx hash={hash} />}</div>;
  switch (f.kind) {
    case FeedKind.Chat:
      if (privateTxOf(f.text)) { body = <PrivateCard hash={privateTxOf(f.text)!} author={f.who} />; break; }
      body = <div className={`msg ${mine ? 'mine' : ''}`}><Avatar id={f.who} /><div style={{ minWidth: 0 }}><div className="msg-meta"><b>{name}</b><span>{time}</span>{hash && <Tx hash={hash} />}</div><div className="bubble">{f.text}</div></div></div>;
      break;
    case FeedKind.Pitch:
      body = <TradeCard item={f} p={p} st={st} markets={markets} events={st.feed} onDone={onDone} />;
      break;
    case FeedKind.VoteYes:
    case FeedKind.VoteNo:
      if (p && p.proposer.toLowerCase() === f.who.toLowerCase() && f.kind === FeedKind.VoteYes && prev?.kind === FeedKind.Pitch && prev.ref === f.ref) return null; // the pitcher's own yes is on the card
      body = ev('butter', f.kind === FeedKind.VoteYes ? 'thumb' : 'thumbDown', <span><b>{name}</b> voted {f.kind === FeedKind.VoteYes ? 'yes' : 'no'} on #{f.ref} <span className="faint">· {sharePct(BigInt(f.amount))}% of shares</span></span>);
      break;
    case FeedKind.Executed: {
      if (!p) return null;
      const m = MARKETS[p.market]!;
      if (p.kind === Kind.Close) body = ev(p.resultPnl >= 0n ? 'mint' : 'pink', 'check', <span>Vault closed {fmtSize(p.filled, m.sizeDp)} {m.symbol} on the book · <b className={p.resultPnl >= 0n ? 'up' : 'down'}>{signedUsd(p.resultPnl)} tUSDC</b></span>);
      else if (p.kind === Kind.Open) body = ev('coral', 'bolt', <span>Vote passed · vault opened <b>{fmtSize(p.filled, m.sizeDp)} {m.symbol} {p.isLong ? 'long' : 'short'}</b> at ${fmtPrice(BigInt(p.avgPrice), m.priceDp === 0 ? 0 : 3)}</span>);
      else body = ev('butter', 'check', <span>Vote passed · {p.kind === Kind.SetCaptain ? `${nameOf(p.target) || 'nobody'} is captain` : `${nameOf(p.target)} invited`}</span>);
      return <>{showDay && <div className="daysep">{new Date(f.ts * 1000).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</div>}<ExecEvent f={f} st={st}>{body}</ExecEvent></>;
    }
    case FeedKind.ExecFailed:
      body = ev('pink', 'x', <span>Vote on #{f.ref} passed, but the venue refused the order. The vote stands.</span>);
      break;
    case FeedKind.Deposit:
      body = ev('butter', 'jar', <span><b>{name}</b> chipped in <b className="mono">{usd(BigInt(f.amount))}</b> tUSDC</span>);
      break;
    case FeedKind.Ragequit:
      body = ev('pink', 'exit', <span><b>{name}</b> ragequit with <b className="mono">{usd(BigInt(f.amount))}</b> tUSDC</span>);
      break;
    case FeedKind.CaptainTrade:
      body = ev('coral', 'key', <span>Captain <b>{name}</b>: <span className="mono">{f.text}</span>{f.ref === CAPTAIN_REF && f.text.startsWith('/close') ? <> · <b>{signedUsd(BigInt(f.amount))} tUSDC</b></> : null}</span>);
      break;
    case FeedKind.MemberAdded:
      body = ev('mint', 'plus', <span><b>{nameOf(f.who)}</b> joined the crew</span>);
      break;
    default:
      body = null;
  }
  return <>{showDay && <div className="daysep">{new Date(f.ts * 1000).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</div>}{body}</>;
}

function ExecEvent({ f, st, children }: { f: Item; st: CrewState; children: React.ReactNode }) {
  const [hash, setHash] = useState<string>();
  useEffect(() => { void feedTx(st.address, f.index, f.block).then(setHash).catch(() => undefined); }, [st.address, f.index, f.block]);
  return <div className="exec-wrap">{children}{hash && <span className="exec-tx"><Tx hash={hash} label="on Snowtrace" /></span>}</div>;
}

