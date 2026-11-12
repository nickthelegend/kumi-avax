import { useEffect, useRef, useState } from 'react';
import type { Address } from 'viem';
import { MARKETS, readChannelMessages, readChannels, preview, price as fmtPrice, size as fmtSize, usd, signedUsd, parseDecimal, perpsAbi, type Channel, type ChatItem } from '@kumi-avax/sdk';
import { PERPS, pub, useLive } from '../lib/chain';
import { LOBBY, callInChannel, copyCall, joinChannel, sayInChannel } from '../lib/lobby';
import { nameOf, useWho } from '../lib/signer';
import { Avatar, CrewAvatar, EmptyArt, Ic, Link, MiniEmpty, Notice, Obj, Tx, ago, crewTone, navigate } from '../ui/bits';
import { TokenLogo } from '../ui/logos';
import { PrivateCard, PrivatePanel, PrivateSheet } from '../ui/Private';

/** The public chats in the room's left list (same rows as the crews). */
export function PublicChats({ current }: { current?: number }) {
  const who = useWho();
  const chans = useLive(() => readChannels(pub as any, LOBBY, who?.address), [who?.address], 20_000);
  return <div className="list-head" style={{ paddingTop: 8 }}>
    <div className="row-between"><h2>Public chats</h2><span className="chip chip-mint"><span className="dot" />open to all</span></div>
    {chans.error && !chans.data && <Notice error>Could not read the Kumi lobby: {chans.error}</Notice>}
    {!chans.data && !chans.error && <div className="skeleton" style={{ height: 120 }} />}
    <ul className="crew-list" style={{ padding: 0 }}>
      {(chans.data ?? []).map(c => <li key={c.id}>
        <a href={`/room?chat=l-${c.id}`} className={`crew-item tone-${crewTone(`lobby-${c.id}`)}`} aria-current={current === c.id ? 'page' : undefined} onClick={e => { e.preventDefault(); navigate(`/room?chat=l-${c.id}`); }}>
          <CrewAvatar address={`lobby-${c.id}`} name={c.name} />
          <span style={{ minWidth: 0 }}><span className="n" style={{ display: 'block' }}>{c.name}</span><span className="p" style={{ display: 'block' }}>{c.memberCount} members · {MARKETS[c.market]?.pair}</span></span>
          <span className="meta">{c.joined ? <span className="chip chip-mint" style={{ height: 22 }}>joined</span> : <span className="t">{c.messageCount} msgs</span>}</span>
        </a>
      </li>)}
    </ul>
  </div>;
}

type Tab = 'crews' | 'chat' | 'fund';

/** A KumiLobby channel: chat, trade calls and verified copies, read from Fuji; the same chat the phone app shows. */
export function LobbyRoom({ channel, list }: { channel: number; list: React.ReactNode }) {
  const who = useWho();
  const [tab, setTab] = useState<Tab>('chat');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sheet, setSheet] = useState<null | 'call' | ChatItem>(null);
  const [tip, setTip] = useState<ChatItem | null>(null);
  const live = useLive(async () => {
    const [items, chans] = await Promise.all([readChannelMessages(pub as any, LOBBY, channel, 120), readChannels(pub as any, LOBBY, who?.address)]);
    const c = chans[channel];
    if (!c) throw Error(`No channel #${channel} in the Kumi lobby`);
    return { items, c };
  }, [channel, who?.address], 4000);
  const pos = useLive(() => (who ? pub.readContract({ address: PERPS, abi: perpsAbi, functionName: 'positionsOf', args: [who.address] }) : Promise.resolve([])), [who?.address], 8000);
  const box = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);
  const n = live.data?.items.length ?? 0;
  useEffect(() => { const b = box.current; if (b && stuck.current) b.scrollTop = b.scrollHeight; }, [n, tab]);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label); setErr(null); stuck.current = true;
    try { await fn(); live.reload(); pos.reload(); } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };
  if (live.error && !live.data) return <div className="room" data-tab={tab}>{list}<section className="pane thread"><div style={{ padding: 24 }}><Notice error>Could not read this chat from Fuji: {live.error}</Notice></div></section><aside className="pane fund" /></div>;
  if (!live.data) return <div className="room" data-tab={tab}>{list}<section className="pane thread"><div className="skeleton" style={{ height: 220, margin: 24 }} /></section><aside className="pane fund"><div className="skeleton" style={{ height: 260 }} /></aside></div>;
  const { items, c } = live.data;
  const copies = new Map<number, ChatItem[]>();
  for (const it of items) if (it.kind === 'copy') copies.set(it.ref, [...(copies.get(it.ref) ?? []), it]);
  const mk = MARKETS[c.market]!;
  const calls = items.filter(i => i.kind === 'call');

  return <div className="room" data-tab={tab}>
    {list}
    <section className="pane thread" aria-label={`${c.name} chat`}>
      <div className="thread-head">
        <CrewAvatar address={`lobby-${channel}`} name={c.name} />
        <div className="grow"><h1>{c.name}</h1><div className="sub"><span className="live"><i />Live on Fuji</span>{c.memberCount} members · public</div></div>
        <span className="chip chip-plum hide-sm">KumiLobby #{channel}</span>
      </div>
      <div className="messages" aria-live="polite" ref={box} onScroll={e => { const b = e.currentTarget; stuck.current = b.scrollHeight - b.scrollTop - b.clientHeight < 80; }}>
        <p className="faint" style={{ textAlign: 'center', fontSize: 13, margin: 0 }}>{c.topic}</p>
        {items.length === 0 && <EmptyArt art={['kumi3-empty', 'kumi-feature-chat']} title="Quiet in here">Say hi, or post the first trade call.</EmptyArt>}
        {items.map((m, i) => <LobbyMessage key={m.key} m={m} prev={items[i - 1]} me={who?.address} copies={copies.get(m.index) ?? []} joined={c.joined} onCopy={() => setSheet(m)} onTip={() => setTip(m)} />)}
      </div>
      <div className="composer">
        {err && <div style={{ marginBottom: 10 }}><Notice error>{err}</Notice></div>}
        {!who ? <div className="guest-bar"><p><b>Read-only.</b> Connect a wallet on Fuji to join, chat and copy calls.</p></div>
          : !c.joined ? <div className="guest-bar"><p><b>Public chat.</b> Joining is one Fuji transaction (KumiLobby.join).</p><button className="btn btn-mint" disabled={!!busy} onClick={() => run('Joining', () => joinChannel(channel))}>{busy ? <span className="spin" /> : <Ic name="plus" size={16} />}Join {c.name}</button></div>
          : <>
            <div className="hints"><span className="lbl">Call:</span><button className="hint tone-coral" onClick={() => setSheet('call')}>Long {mk.symbol} 3x · 50 tUSDC</button><button className="hint tone-pink" onClick={() => setSheet('call')}>Short {mk.symbol} 2x</button></div>
            <form className="composer-box" onSubmit={e => { e.preventDefault(); const t = text.trim(); if (t) void run('Sending', async () => { await sayInChannel(channel, t); setText(''); }); }}>
              <input value={text} onChange={e => { setText(e.target.value); setErr(null); }} placeholder={`Message ${c.name}`} aria-label="Message" maxLength={280} disabled={!!busy} />
              <button className="send" aria-label="Send" disabled={!!busy || !text.trim()}>{busy ? <span className="spin" /> : <Ic name="send" size={19} />}</button>
            </form>
            <p className="composer-note">{busy ? `${busy}…` : 'Every message is a Fuji transaction. The same chat is in the Kumi phone app.'}</p>
          </>}
      </div>
    </section>
    <aside className="pane fund" aria-label="About this chat">
      <PrivatePanel />
      <section className="card">
        <div className="card-head"><h3>About</h3><span className="chip chip-mint chip-live"><span className="dot" />on-chain</span></div>
        <p className="muted" style={{ margin: '0 0 10px', fontSize: 14 }}>{c.topic}</p>
        <div className="row" style={{ gap: 10 }}><TokenLogo sym={mk.symbol} size={30} /><span><b>{mk.pair}</b><br /><small className="faint">calls default to this market</small></span></div>
        <div className="hero-stats" style={{ color: 'var(--ink)' }}>
          <span style={{ background: 'var(--panel-2)' }}><small style={{ color: 'var(--ink-3)' }}>Members</small><b>{c.memberCount}</b></span>
          <span style={{ background: 'var(--panel-2)' }}><small style={{ color: 'var(--ink-3)' }}>Calls</small><b>{calls.length}</b></span>
          <span style={{ background: 'var(--panel-2)' }}><small style={{ color: 'var(--ink-3)' }}>Copies</small><b>{items.filter(i => i.kind === 'copy').length}</b></span>
        </div>
        <p className="fine">Channel <a className="hash" href={`https://testnet.snowtrace.io/address/${LOBBY}`} target="_blank" rel="noreferrer">KumiLobby #{channel}</a> · copies are checked against KumiPerps positions</p>
      </section>
      <section className="card">
        <div className="card-head"><h3>Your positions</h3><Link to={`/markets/${mk.symbol}`} className="text-link" style={{ minHeight: 0, fontSize: 13 }}>Market <Ic name="arrow" size={13} /></Link></div>
        {!who ? <MiniEmpty obj="jar">Connect a wallet to see your KumiPerps positions.</MiniEmpty>
          : !pos.data ? <div className="skeleton" style={{ height: 60 }} />
          : pos.data.length === 0 ? <MiniEmpty obj="rocket">No open positions. Copy a call to open one on the book.</MiniEmpty>
          : pos.data.map(p => { const m = MARKETS[p.market]!; return <div key={p.market} className="position"><div className="pos-top"><TokenLogo sym={m.symbol} size={32} /><span className="pos-id"><b>{m.symbol} <span className={`side-tag ${p.size > 0n ? 'long' : 'short'}`}>{p.size > 0n ? 'Long' : 'Short'}</span></b><small>{fmtSize(p.size < 0n ? -p.size : p.size, m.sizeDp)} @ {fmtPrice(p.entry, m.priceDp)}</small></span><span className={`pos-pnl ${p.unrealized >= 0n ? 'up' : 'down'}`}>{signedUsd(p.unrealized)}<small>at Chainlink</small></span></div></div>; })}
      </section>
    </aside>
    <nav className="tabs" aria-label="Sections">
      {([['crews', 'Chats', 'crews'], ['chat', 'Chat', 'chat'], ['fund', 'Info', 'chart']] as const).map(([t, l, ic]) => <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}><Ic name={ic} size={19} />{l}</button>)}
    </nav>
    {sheet === 'call' && <CallSheet channel={channel} market={c.market} onClose={() => setSheet(null)} onDone={() => live.reload()} />}
    {tip && who && <PrivateSheet me={who.address} to={tip.who} where={{ kind: 'tip', channel, ref: tip.index }} title={`Tip ${nameOf(tip.who)} privately`} onClose={() => setTip(null)} onDone={() => live.reload()} />}
    {sheet && typeof sheet === 'object' && who && <CopySheet channel={channel} call={sheet} me={who.address} onClose={() => setSheet(null)} onDone={() => { live.reload(); pos.reload(); }} />}
  </div>;
}

function LobbyMessage({ m, prev, me, copies, joined, onCopy, onTip }: { m: ChatItem; prev?: ChatItem; me?: Address; copies: ChatItem[]; joined: boolean; onCopy: () => void; onTip: () => void }) {
  const mine = !!me && m.who.toLowerCase() === me.toLowerCase();
  const mk = MARKETS[m.market ?? 0]!;
  if (m.kind === 'private' && m.privateTx) return <PrivateCard hash={m.privateTx} author={m.who} />;
  if (m.kind === 'chat') {
    const showWho = !prev || prev.who !== m.who || prev.kind !== 'chat';
    return <div className={`msg ${mine ? 'mine' : ''}`}>
      {showWho ? <Avatar id={m.who} /> : <span style={{ width: 34, flex: 'none' }} />}
      <div style={{ minWidth: 0 }}>
        {showWho && <div className="msg-meta"><b>{mine ? 'You' : nameOf(m.who)}</b><span>{ago(m.ts)}</span></div>}
        <div className="bubble">{m.text}</div>
      </div>
    </div>;
  }
  if (m.kind === 'call') {
    const copiedByMe = !!me && copies.some(c => c.who.toLowerCase() === me.toLowerCase());
    return <article className={`trade ${mine ? 'mine' : ''}`} data-call={m.index}>
      <div className={`trade-top ${m.isLong ? '' : 'sell'}`}>
        <span className="asset-logo"><TokenLogo sym={mk.symbol} size={42} /></span>
        <div className="trade-title"><span className="trade-kind">{nameOf(m.who)} called · #{m.index}</span><b>{m.isLong ? 'Long' : 'Short'} {mk.symbol} {m.leverage}x</b><span>{usd(m.amount, 0)} tUSDC margin · {usd(m.amount * BigInt(m.leverage ?? 1), 0)} notional</span></div>
        <span className="st st-voting" style={{ background: '#fff', color: 'var(--plum)', padding: '4px 10px', borderRadius: 99, fontWeight: 800, fontSize: 12 }}>{copies.length} copied</span>
      </div>
      <div className="trade-body">
        {m.text && <p style={{ margin: 0 }}>"{m.text}"</p>}
        <div className="pos-grid" style={{ marginTop: 0 }}>
          <div><dt>Chainlink when called</dt><dd>{m.price ? `$${fmtPrice(m.price, mk.priceDp)}` : 'feed stale'}</dd></div>
          <div><dt>Copies</dt><dd>{copies.length}</dd></div>
          <div><dt>Called</dt><dd>{ago(m.ts)}</dd></div>
        </div>
        {copies.length > 0 && <div className="voters">{copies.map(c => <span key={c.key} className="voter y"><Avatar id={c.who} />{nameOf(c.who)}</span>)}</div>}
        {mine ? <span className="chip chip-coral">Your call</span>
          : copiedByMe ? <div className="row-between"><span className="chip chip-mint"><span className="dot" />You copied this</span><button className="btn btn-plum btn-sm" onClick={onTip}><Ic name="lock" size={15} />Tip privately</button></div>
          : me && joined ? <button className="btn btn-primary btn-block" onClick={onCopy}><Ic name="bolt" size={16} />Copy with {usd(m.amount, 0)} tUSDC</button>
          : <p className="faint" style={{ margin: 0, fontSize: 13 }}>{me ? 'Join the chat to copy calls.' : 'Connect a wallet to copy calls.'}</p>}
      </div>
    </article>;
  }
  if (m.kind === 'copy') {
    return <div className="exec-wrap">
      <div className="event tone-mint"><span className="ev-ic"><Ic name="check" size={14} /></span><span><b>{nameOf(m.who)}</b> copied #{m.ref}: {m.isLong ? 'long' : 'short'} <b className="mono">{fmtSize(m.size ?? 0n, mk.sizeDp)} {mk.symbol}</b> at <b className="mono">${fmtPrice(m.price ?? 0n, mk.priceDp)}</b></span></div>
      {m.orderTx && <span className="exec-tx"><Tx hash={m.orderTx} label="order" /></span>}
    </div>;
  }
  return <div className={`event tone-${m.kind === 'leave' ? 'pink' : 'mint'}`}><span className="ev-ic"><Ic name={m.kind === 'leave' ? 'exit' : 'plus'} size={14} /></span><span><b>{nameOf(m.who)}</b> {m.kind === 'leave' ? 'left' : 'joined'}</span></div>;
}

function CallSheet({ channel, market, onClose, onDone }: { channel: number; market: number; onClose: () => void; onDone: () => void }) {
  const [mkt, setMkt] = useState(market);
  const [long, setLong] = useState(true);
  const [lev, setLev] = useState(3);
  const [margin, setMargin] = useState('50');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return <div className="scrim" onClick={onClose}><div className="sheet" role="dialog" aria-label="Post a trade call" onClick={e => e.stopPropagation()}>
    <div className="row-between"><h3>Post a call</h3><button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close"><Ic name="x" /></button></div>
    <div className="seg">{MARKETS.map(m => <button key={m.id} aria-pressed={mkt === m.id} onClick={() => setMkt(m.id)}>{m.pair}</button>)}</div>
    <div className="seg3"><button aria-pressed={long} onClick={() => setLong(true)}>Long</button><button aria-pressed={!long} onClick={() => setLong(false)}>Short</button></div>
    <div className="seg seg4" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>{[1, 2, 3, 5, 10].map(l => <button key={l} aria-pressed={lev === l} onClick={() => setLev(l)}>{l}x</button>)}</div>
    <label className="field"><span className="label">Suggested margin (tUSDC)</span><input className="input mono" value={margin} onChange={e => setMargin(e.target.value)} inputMode="decimal" /></label>
    <label className="field"><span className="label">Why (optional)</span><input className="input" value={note} onChange={e => setNote(e.target.value)} maxLength={280} /></label>
    <div className="notice">A call moves no money. Copiers place their own orders on KumiPerps; the lobby checks each position.</div>
    {err && <Notice error>{err}</Notice>}
    <button className="btn btn-primary btn-lg" disabled={busy} onClick={async () => { setBusy(true); setErr(null); try { await callInChannel(channel, mkt, long, lev, parseDecimal(margin, 6), note.trim()); onDone(); onClose(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } }}>{busy ? <span className="spin" /> : <Ic name="bolt" />}Call {long ? 'Long' : 'Short'} {MARKETS[mkt]!.symbol} {lev}x</button>
  </div></div>;
}

function CopySheet({ channel, call, me, onClose, onDone }: { channel: number; call: ChatItem; me: Address; onClose: () => void; onDone: () => void }) {
  const mk = MARKETS[call.market ?? 0]!;
  const [margin, setMargin] = useState(usd(call.amount, 0).replace(/,/g, ''));
  const [step, setStep] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [order, setOrder] = useState<string | null>(null);
  return <div className="scrim" onClick={onClose}><div className="sheet" role="dialog" aria-label={`Copy call #${call.index}`} onClick={e => e.stopPropagation()}>
    <div className="row-between"><h3>Copy #{call.index}</h3><button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close"><Ic name="x" /></button></div>
    <p className="sub">{call.isLong ? 'Long' : 'Short'} {mk.symbol} {call.leverage}x, called by {nameOf(call.who)}{call.price ? ` at $${fmtPrice(call.price, mk.priceDp)}` : ''}.</p>
    {order ? <>
      <div className="row" style={{ gap: 12 }}><Obj name="success" size={64} /><div><b>Copied on the book.</b><br /><Tx hash={order} label="order" /></div></div>
      <button className="btn btn-plum" onClick={onClose}>Back to the chat</button>
    </> : <>
      <label className="field"><span className="label">Your margin (tUSDC)</span><input className="input mono" value={margin} onChange={e => setMargin(e.target.value)} inputMode="decimal" /></label>
      <ol className="rules-list"><li>Deposit margin into KumiPerps (approve once)</li><li>IOC order on the on-chain book</li><li>KumiLobby.copy checks your position and posts it</li></ol>
      {err && <Notice error>{err}</Notice>}
      <button className="btn btn-primary btn-lg" disabled={!!step} onClick={async () => { setErr(null); try { const h = await copyCall(me, channel, call, parseDecimal(margin, 6), setStep); setOrder(h); onDone(); } catch (e) { setErr((e as Error).message); } finally { setStep(null); } }}>{step ? <><span className="spin" />{step}…</> : <><Ic name="bolt" />Copy on the book</>}</button>
    </>}
  </div></div>;
}

export type { Channel };
export const lobbyPreview = (m: ChatItem) => preview(m, nameOf);
