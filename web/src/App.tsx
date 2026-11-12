import { useEffect } from 'react';
import { TopNav, usePath } from './ui/bits';
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
  else if (p.startsWith('/markets')) page = <Markets sym={p.split('/')[2]} />;
  else if (p.startsWith('/crew')) page = <CrewPage address={p.split('/')[2]} />;
  else page = <div className="page"><div className="card"><h2>Not found</h2><p className="muted">No page at {p}.</p></div></div>;
  return <>
    <TopNav path={p} />
    <main>{page}</main>
  </>;
}
