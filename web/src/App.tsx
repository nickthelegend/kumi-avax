import { useEffect } from 'react';
import { Art, Link, TopNav, usePath } from './ui/bits';
import { restoreQa } from './lib/signer';
import { Landing } from './pages/Landing';
import { Room } from './pages/Room';
import { Markets } from './pages/Markets';
import { CrewPage } from './pages/CrewPage';

export function App() {
  const path = usePath();
  useEffect(() => { restoreQa(); }, []);
  const p = path.split('?')[0]!;
  let page;
  if (p === '/') page = <Landing />;
  else if (p.startsWith('/room')) page = <Room key={path} />;
  else if (p.startsWith('/markets')) page = <Markets key={p} sym={p.split('/')[2]} />;
  else if (p.startsWith('/crew')) page = <CrewPage address={p.split('/')[2]} />;
  else page = <div className="page"><div className="card not-found"><Art name="kumi4-offline" alt="A worried penguin holding an unplugged cable" /><h2>Nothing here</h2><p className="muted">No page at <span className="mono">{p}</span>.</p><Link to="/" className="btn btn-primary">Back to Kumi</Link></div></div>;
  return <>
    <TopNav path={p} />
    <main>{page}</main>
  </>;
}
