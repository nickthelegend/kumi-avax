import { useEffect, useState, type ReactNode } from 'react';
import { txUrl, addressUrl } from '@kumi-avax/sdk';
import { connectWallet, disconnect, nameOf, qaMembers, QA, selectQa, useWho } from '../lib/signer';
import { AvaxMark } from './logos';

export function navigate(to: string) {
  history.pushState(null, '', to);
  dispatchEvent(new PopStateEvent('popstate'));
  window.scrollTo({ top: 0 });
}
export function usePath() {
  const [p, set] = useState(location.pathname + location.search);
  useEffect(() => { const f = () => set(location.pathname + location.search); addEventListener('popstate', f); return () => removeEventListener('popstate', f); }, []);
  return p;
}
export function Link({ to, children, className, style, ...rest }: { to: string; children: ReactNode; className?: string; style?: React.CSSProperties; 'aria-current'?: 'page'; 'aria-label'?: string; title?: string }) {
  return <a href={to} className={className} style={style} {...rest} onClick={e => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); navigate(to); }}>{children}</a>;
}

/** Kumi's clay art: tries each name in order, then an intentional gradient. */
export function Art({ name, alt, className, eager }: { name: string | string[]; alt: string; className?: string; eager?: boolean }) {
  const names = Array.isArray(name) ? name : [name];
  const [i, setI] = useState(0);
  if (i >= names.length) return <div className={`art-fallback ${className ?? ''}`} role="img" aria-label={alt} />;
  return <img key={names[i]} className={className} src={`/art/${names[i]}.webp`} alt={alt} loading={eager ? 'eager' : 'lazy'} decoding="async" onError={() => setI(n => n + 1)} />;
}

export const TONES = ['coral', 'butter', 'mint', 'pink'] as const;
const ANIMALS = ['owl', 'fox', 'bear', 'frog'];
const hashOf = (id: string) => { let h = 0; for (const c of id.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
export const crewTone = (addr: string) => TONES[hashOf(addr) % TONES.length]!;
export function CrewAvatar({ address, name, size }: { address: string; name: string; size?: 'lg' | 'sm' }) {
  const [ok, setOk] = useState(true);
  return <span className={`crew-av tone-${crewTone(address)} ${size ? `crew-av-${size}` : ''}`} aria-hidden>
    {ok ? <img src={`/art/kumi3-av-${ANIMALS[hashOf(address) % ANIMALS.length]}.webp`} alt="" onError={() => setOk(false)} /> : name.slice(0, 1)}
  </span>;
}

const HUES = ['#ff6f59', '#ffd166', '#3ddc97', '#ff8fc7', '#ffb38a', '#c8e66b'];
/** Every member is one of the clay crew mascots, picked from their address. */
const MEMBER_MASCOT: Record<string, string> = { mika: 'owl', bo: 'bear', ren: 'fox' };
export const mascotOf = (a: string) => MEMBER_MASCOT[nameOf(a)] ?? ANIMALS[hashOf(a) % ANIMALS.length]!;
export const memberHue = (a: string) => HUES[hashOf(a) % HUES.length]!;
export function Avatar({ id, size }: { id: string; size?: 'lg' }) {
  const [ok, setOk] = useState(true);
  return <span className={`avatar ${size === 'lg' ? 'avatar-lg' : ''} ${ok ? 'avatar-m' : ''}`} style={{ background: memberHue(id) }} title={nameOf(id)} aria-hidden>
    {ok ? <img src={`/art/kumi3-av-${mascotOf(id)}.webp`} alt="" onError={() => setOk(false)} /> : nameOf(id).slice(0, 2)}
  </span>;
}

export function Tx({ hash, label }: { hash: string; label?: string }) {
  return <a className="hash" href={txUrl(hash)} target="_blank" rel="noreferrer" title={`${label ?? 'transaction'} ${hash} on Snowtrace (Fuji)`}>{label ? `${label} · ` : ''}{hash.slice(0, 6)}…{hash.slice(-4)}</a>;
}
export function Addr({ a, label }: { a: string; label?: string }) {
  return <a className="hash" href={addressUrl(a)} target="_blank" rel="noreferrer" title={`${a} on Snowtrace (Fuji)`}>{label ?? `${a.slice(0, 6)}…${a.slice(-4)}`}</a>;
}

export function Notice({ children, error }: { children: ReactNode; error?: boolean }) {
  if (error) return <div className="notice notice-error notice-obj" role="alert"><Obj name="warning" size={34} still /><div>{children}</div></div>;
  return <div className="notice" role="status">{children}</div>;
}

export type ObjName = 'captain' | 'chat' | 'coins' | 'crown' | 'door' | 'empty' | 'hourglass' | 'jar' | 'mark' | 'rocket' | 'shield' | 'success' | 'vote' | 'warning';
/** One object from the Kumi 3D kit (public/art/3d). */
export function Obj({ name, size = 64, alt, className, still }: { name: ObjName; size?: number; alt?: string; className?: string; still?: boolean }) {
  return <img className={`obj ${still ? 'obj-still' : ''} ${className ?? ''}`} src={`/art/3d/kumi-3d-${name}.webp`} width={size} height={size} alt={alt ?? ''} aria-hidden={alt ? undefined : true} loading="lazy" decoding="async" />;
}
export function MiniEmpty({ obj, children }: { obj: ObjName; children: ReactNode }) {
  return <div className="mini-empty"><Obj name={obj} size={56} /><p className="mini">{children}</p></div>;
}
export function EmptyArt({ art, title, children, action }: { art: string | string[]; title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="empty-art"><div className="img"><Art name={art} alt="" /></div><h4>{title}</h4>{children && <p>{children}</p>}{action}</div>;
}

export function Brand() {
  return <Link to="/" className="brand" aria-label="Kumi home"><span className="brand-mark"><i /></span>Kumi<small>組</small></Link>;
}

export function TopNav({ path }: { path: string }) {
  const who = useWho();
  const [err, setErr] = useState<string | null>(null);
  const cur = (p: string) => (path === p || (p !== '/' && path.startsWith(p)) ? 'page' : undefined);
  const qa = qaMembers();
  return (
    <header className="nav">
      <div className={`nav-in ${path.startsWith('/room') || path.startsWith('/markets') ? 'wide' : ''}`}>
        <Brand />
        <nav className="nav-links" aria-label="Main">
          <Link to="/room" aria-current={cur('/room')} aria-label="Crew chat"><Ic name="chat" size={16} /><span className="nl">Crew chat</span></Link>
          <Link to="/markets" aria-current={cur('/markets')} aria-label="Markets"><Ic name="book" size={16} /><span className="nl">Markets</span></Link>
          <Link to="/crew" aria-current={cur('/crew')} aria-label="Crew fund"><Ic name="jar" size={16} /><span className="nl">Crew fund</span></Link>
        </nav>
        <div className="nav-right">
          <span className="net-pill"><AvaxMark size={14} />Fuji testnet</span>
          {QA && qa.length > 0 ? (
            <label className="who qa-who" title="QA signer: a Fuji test key injected by the test harness (QA builds only)">
              {who && <Avatar id={who.address} />}
              <span className="sr">Signed in as</span>
              <select value={who?.label ?? ''} onChange={e => selectQa(e.target.value)} aria-label="QA signer">
                {qa.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              <span className="qa-tag">QA</span>
            </label>
          ) : who ? (
            <button className="who" onClick={() => { if (confirm(`Disconnect ${who.label}?`)) disconnect(); }} title={`${who.address} · click to disconnect`}>
              <Avatar id={who.address} /><span className="who-label">{who.label}</span>
            </button>
          ) : (
            <button className="btn btn-sm btn-plum" onClick={() => connectWallet().catch(e => setErr((e as Error).message))}><span className="nl-full">Connect wallet</span><span className="nl-short">Connect</span></button>
          )}
          {path === '/' && <Link to="/room" className="btn btn-primary btn-sm hide-sm">Open the room</Link>}
        </div>
      </div>
      {err && <div className="nav-err"><Notice error>{err} <button className="btn btn-sm btn-ghost" onClick={() => setErr(null)}>Dismiss</button></Notice></div>}
    </header>
  );
}

const paths: Record<string, string> = {
  send: 'M4 12l16-8-6 16-2.5-6.5L4 12z',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6L6 18',
  up: 'M7 17L17 7M9 7h8v8',
  down: 'M7 7l10 10M17 9v8H9',
  chat: 'M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H10l-4 3.5V17H6a2 2 0 0 1-2-2z',
  crews: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2.5 19a5.5 5.5 0 0 1 11 0M10.5 19a5.5 5.5 0 0 1 11 0',
  jar: 'M8 3h8M7 6h10M7 6l-1 3v9a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V9l-1-3M9 13h6',
  thumb: 'M7 11v9H4v-9zM7 11l4-7a2 2 0 0 1 2 2v4h5a2 2 0 0 1 2 2.3l-1.2 6A2 2 0 0 1 16.8 20H7',
  thumbDown: 'M17 13V4h3v9zM17 13l-4 7a2 2 0 0 1-2-2v-4H6a2 2 0 0 1-2-2.3l1.2-6A2 2 0 0 1 7.2 4H17',
  exit: 'M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l-4-4 4-4M6 12h10',
  plus: 'M12 6v12M6 12h12',
  key: 'M14.5 9.5a4.5 4.5 0 1 0-3.9 4.46L10 15h-2v2H6v2H3v-3l6.04-6.04A4.5 4.5 0 0 0 14.5 9.5zM15.5 8.5h.01',
  chart: 'M4 19h16M6 15l4-4 3 3 5-6',
  bolt: 'M13 3L5 13h6l-1 8 8-10h-6z',
  book: 'M4 6h7M4 10h5M4 14h8M4 18h4M14 6h6M16 10h4M13 14h7M17 18h3',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  shield: 'M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z',
  lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3M12 15v2',
  fire: 'M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5.3 1.6 1 2.5 2 3 0-3 0-5.5 1-8.5z',
  coin: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9 9.5c0-1 1.3-1.8 3-1.8s3 .8 3 1.8-1.3 1.6-3 1.9-3 .9-3 1.9 1.3 1.8 3 1.8 3-.8 3-1.8M12 6v1.7M12 16.3V18',
};
export function Ic({ name, size = 18 }: { name: string; size?: number }) {
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

/** "3 min ago" from a unix second. */
export function ago(ts: number): string {
  const s = Math.max(0, Math.round(Date.now() / 1000 - ts));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
