import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Address, Hex } from 'viem';
import { NO_REF, parsePrivate } from '@kumi-avax/sdk/eerc';
import { useLive, USDC, pub } from '../lib/chain';
import { usdcAbi } from '@kumi-avax/sdk';
import { nameOf, useWho } from '../lib/signer';
import { EERC, fmt, keyOpen, moveIn, moveOut, onKeys, openPrivate, privateKey, readCard, readPrivate, sendPrivately, type Where } from '../lib/private';
import { Avatar, Ic, MiniEmpty, Notice, Obj, Tx } from './bits';

const useKeyOpen = (a?: Address) => useSyncExternalStore(onKeys, () => keyOpen(a));

/**
 * A private tip or send in a chat (`kumi:private:<tx>`), checked against Fuji. Everyone sees that it happened;
 * only the sender and the receiver (after opening their key) and Kumi's auditor can read the amount.
 */
export function PrivateCard({ hash, author }: { hash: Hex; author: Address }) {
  const who = useWho();
  const open = useKeyOpen(who?.address);
  const c = useLive(() => readCard(hash, author, who?.address), [hash, author, who?.address, open], 0);
  const [err, setErr] = useState<string | null>(null);
  const s = c.data?.send;
  const mine = !!who && author.toLowerCase() === who.address.toLowerCase();
  const party = !!who && !!s && (mine || s.to.toLowerCase() === who.address.toLowerCase());
  const toMe = !!who && !!s && s.to.toLowerCase() === who.address.toLowerCase();
  const ref = s?.memo && s.memo.ref !== NO_REF ? Number(s.memo.ref) : null;
  if (c.error && !c.data) return <div className="event tone-pink"><span className="ev-ic"><Ic name="x" size={14} /></span><span><b>{nameOf(author)}</b> posted a private-send card that does not check out: {c.error}</span></div>;
  return (
    <article className={`pcard ${mine ? 'mine' : ''}`} aria-label="Private send">
      <div className="pcard-top">
        <Obj name="shield" size={52} />
        <div className="grow" style={{ minWidth: 0 }}>
          <span className="pcard-kind">{s?.memo?.kind === 'send' ? 'Private send' : 'Private tip'} · eERC</span>
          <b className="pcard-title">{mine ? 'You' : nameOf(author)} → {s ? (toMe ? 'you' : nameOf(s.to)) : '…'}</b>
          <span className="pcard-sub">{!s ? '\u00a0' : ref !== null ? `for call #${ref}` : 'inside the crew'}</span>
        </div>
        {s && <Avatar id={s.to} />}
      </div>
      <div className="pcard-amt">
        {!c.data ? <span className="skeleton" style={{ height: 34, flex: 1, opacity: .25 }} />
          : c.data.amount !== null ? <><b className="mono">{toMe ? '+' : ''}{fmt(c.data.amount)}</b><span>tUSDC. Only you, {toMe ? nameOf(author) : nameOf(s!.to)} and Kumi's auditor can read this.</span></>
          : <><span className="pcard-lock"><Ic name="lock" size={16} /></span><span><b>Amount hidden</b> on-chain.</span>
            {party && who && <button className="btn btn-sm pcard-reveal" onClick={() => { setErr(null); privateKey(who.address).catch(e => setErr((e as Error).message)); }}>Show amount</button>}</>}
      </div>
      {err && <Notice error>{err}</Notice>}
      <span className="pcard-tx"><Tx hash={hash} label="eERC transfer" /></span>
    </article>
  );
}

/** Right-pane card: your private balance, with open / move in / move out and a private send. */
export function PrivatePanel({ choices, where, title = 'Private balance' }: { choices?: Address[]; where?: Where; title?: string }) {
  const who = useWho();
  const open = useKeyOpen(who?.address);
  const p = useLive(() => (who ? readPrivate(who.address) : Promise.resolve(null)), [who?.address, open], 15_000);
  const [sheet, setSheet] = useState<null | 'in' | 'out' | 'send'>(null);
  const [step, setStep] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [last, setLast] = useState<Hex | null>(null);
  if (!EERC) return null;
  const run = async (fn: () => Promise<Hex | Hex[]>) => { setErr(null); try { const r = await fn(); setLast(Array.isArray(r) ? r[0]! : r); p.reload(); } catch (e) { setErr((e as Error).message); } finally { setStep(null); } };
  const d = p.data;
  return (
    <section className="card" aria-label="Private balance">
      <div className="card-head"><h3>{title}</h3><span className="chip chip-plum"><Ic name="lock" size={12} />eERC</span></div>
      {!who ? <MiniEmpty obj="shield">Connect a wallet to open a private balance. Tips and crew settle-ups move through Ava Labs' encrypted ERC, so Fuji never shows the amount.</MiniEmpty>
        : !d ? <div className="skeleton" style={{ height: 90 }} />
        : <>
          <div className="pbal">
            <Obj name="shield" size={48} />
            <div className="grow" style={{ minWidth: 0 }}>
              <small>{!d.registered ? 'Not opened yet' : d.balance !== null ? 'Decrypted in this browser' : 'Encrypted'}</small>
              <b className="mono">{d.balance !== null ? fmt(d.balance) : d.registered ? '••••' : '0.00'} <span>tUSDC</span></b>
              <small className="mono">{d.fingerprint ? `ciphertext ${d.fingerprint}` : 'nothing on chain yet'}</small>
            </div>
          </div>
          {!d.registered ? <button className="btn btn-plum btn-block" disabled={!!step} onClick={() => run(() => openPrivate(who.address, setStep))}>{step ? <><span className="spin" />{step}…</> : <><Ic name="lock" size={16} />Open private balance</>}</button>
            : d.balance === null ? <button className="btn btn-plum btn-block" disabled={!!step} onClick={() => { setErr(null); privateKey(who.address).catch(e => setErr((e as Error).message)); }}><Ic name="key" size={16} />Decrypt with my key</button>
            : <div className="pbal-actions">
              <button className="btn btn-butter btn-sm" onClick={() => setSheet('in')}><Ic name="plus" size={15} />Move in</button>
              <button className="btn btn-sm" disabled={d.balance === 0n} onClick={() => setSheet('out')}><Ic name="exit" size={15} />Move out</button>
              {where && choices && choices.length > 0 && <button className="btn btn-plum btn-sm" onClick={() => setSheet('send')}><Ic name="send" size={15} />Send privately</button>}
            </div>}
          {step && <p className="fine" style={{ margin: 0 }}>{step}…</p>}
          {err && <Notice error>{err}</Notice>}
          {last && <p className="fine" style={{ margin: 0 }}>Sent on Fuji · <Tx hash={last} /></p>}
          <p className="fine" style={{ margin: 0 }}>Moving in and out is public, like any token transfer. Sends inside are not. Kumi's auditor key can read amounts. <a className="hash" href={`https://testnet.snowtrace.io/address/${EERC}`} target="_blank" rel="noreferrer">eERC on Snowtrace</a></p>
        </>}
      {sheet === 'send' && who && where && <PrivateSheet me={who.address} choices={choices} where={where} title="Send privately" onClose={() => setSheet(null)} onDone={() => p.reload()} />}
      {(sheet === 'in' || sheet === 'out') && who && d && d.balance !== null && <MoveSheet me={who.address} dir={sheet} privateBal={d.balance} onClose={() => setSheet(null)} onDone={h => { setLast(h); p.reload(); }} />}
    </section>
  );
}

export function PrivateSheet({ me, to, choices, where, title, onClose, onDone }: { me: Address; to?: Address; choices?: Address[]; where: Where; title: string; onClose: () => void; onDone: () => void }) {
  const [pick, setPick] = useState<Address | undefined>(to);
  const [amount, setAmount] = useState(where.kind === 'tip' ? '1.00' : '5.00');
  const [step, setStep] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<Hex[] | null>(null);
  const [bal, setBal] = useState<bigint | null>(null);
  useEffect(() => { privateKey(me).then(() => readPrivate(me)).then(d => setBal(d.balance ?? 0n)).catch(e => setErr((e as Error).message)); }, [me]);
  const units = parsePrivate(amount);
  const problem = bal === null ? null : units === null || units === 0n ? 'Enter an amount in tUSDC, like 1.50.' : units > bal ? `You have ${fmt(bal)} tUSDC private. Move more in first.` : !pick ? 'Pick who gets it.' : null;
  return <div className="scrim" onClick={onClose}><div className="sheet" role="dialog" aria-label={title} onClick={e => e.stopPropagation()}>
    <div className="row-between"><h3>{title}</h3><button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close"><Ic name="x" /></button></div>
    {done ? <>
      <div className="row" style={{ gap: 12 }}><Obj name="shield" size={64} /><div><b>Sent privately.</b><br /><span className="muted" style={{ fontSize: 14 }}>{nameOf(pick)} sees the amount; everyone else sees the card.</span><br /><Tx hash={done[0]!} label="eERC transfer" /></div></div>
      <button className="btn btn-plum" onClick={onClose}>Back to the chat</button>
    </> : <>
      {choices ? <div className="field"><span className="label">To</span><div className="voters">{choices.map(a => <button key={a} className={`voter ${pick === a ? 'y' : ''}`} aria-pressed={pick === a} onClick={() => setPick(a)} style={{ cursor: 'pointer' }}><Avatar id={a} />{nameOf(a)}</button>)}</div></div>
        : to && <p className="sub" style={{ margin: 0 }}>To <b>{nameOf(to)}</b>{where.ref !== undefined ? ` for call #${where.ref}` : ''}.</p>}
      <label className="field"><span className="label">Amount (tUSDC) · {bal === null ? 'opening your key…' : `${fmt(bal)} private`}</span><input className="input mono" value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" /></label>
      <ol className="rules-list"><li>Prove the send in this browser (zk, a few seconds)</li><li>Send it on Fuji through the eERC</li><li>Post the card in this chat</li></ol>
      <div className="notice">Snowtrace will show that you sent {pick ? nameOf(pick) : 'them'} something through Kumi's eERC, never how much.</div>
      {(err || problem) && <Notice error>{err ?? problem}</Notice>}
      <button className="btn btn-plum btn-lg" disabled={!!step || !!problem || bal === null} onClick={async () => { setErr(null); try { setDone(await sendPrivately(me, pick!, units!, where, setStep)); onDone(); } catch (e) { setErr((e as Error).message); } finally { setStep(null); } }}>{step ? <><span className="spin" />{step}…</> : <><Ic name="lock" />{where.kind === 'tip' ? 'Tip' : 'Send'} {units ? fmt(units) : ''} privately</>}</button>
    </>}
  </div></div>;
}

function MoveSheet({ me, dir, privateBal, onClose, onDone }: { me: Address; dir: 'in' | 'out'; privateBal: bigint; onClose: () => void; onDone: (h: Hex) => void }) {
  const [amount, setAmount] = useState(dir === 'in' ? '20.00' : fmt(privateBal).replace(/,/g, ''));
  const [step, setStep] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const pubBal = useLive(() => pub.readContract({ address: USDC, abi: usdcAbi, functionName: 'balanceOf', args: [me] }), [me], 0);
  const units = parsePrivate(amount);
  const max = dir === 'in' ? (pubBal.data ?? 0n) / 10_000n : privateBal;
  const problem = units === null || units === 0n ? 'Enter an amount in tUSDC, like 20.00.' : pubBal.data !== undefined && units > max ? `You have ${fmt(max)} tUSDC ${dir === 'in' ? 'in the wallet' : 'private'}.` : null;
  return <div className="scrim" onClick={onClose}><div className="sheet" role="dialog" aria-label={dir === 'in' ? 'Move tUSDC in' : 'Move tUSDC out'} onClick={e => e.stopPropagation()}>
    <div className="row-between"><h3>{dir === 'in' ? 'Move tUSDC in' : 'Move tUSDC out'}</h3><button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close"><Ic name="x" /></button></div>
    <label className="field"><span className="label">Amount (tUSDC) · max {fmt(max)}</span><input className="input mono" value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" /></label>
    <div className="notice">{dir === 'in' ? 'This amount is public: tUSDC moves from your wallet into the eERC contract. What you send inside Kumi after that is private.' : 'This amount is public: tUSDC comes back to your wallet. The proof is made in this browser.'}</div>
    {(err || problem) && <Notice error>{err ?? problem}</Notice>}
    <button className={`btn btn-lg ${dir === 'in' ? 'btn-butter' : 'btn-plum'}`} disabled={!!step || !!problem} onClick={async () => { setErr(null); try { const h = dir === 'in' ? await moveIn(me, units!, setStep) : await moveOut(me, units!, setStep); onDone(h); onClose(); } catch (e) { setErr((e as Error).message); } finally { setStep(null); } }}>{step ? <><span className="spin" />{step}…</> : `Move ${units ? fmt(units) : ''} ${dir}`}</button>
  </div></div>;
}
