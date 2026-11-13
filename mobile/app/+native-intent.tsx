import { routeFor } from '../lib/links';

/**
 * Kumi links opened from outside the app (a friend's message, the camera): kumi://join/<chat> opens that chat, and a
 * join code kumi://invite/<crew>/<address> opens the crew with `/invite <address>` drafted for the crew to vote on.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string | null {
  try {
    const raw = path.startsWith('kumi://') ? path : `kumi://${path.replace(/^\/+/, '')}`;
    const r = routeFor(raw);
    if (!r) return path;
    const q = r.params ? `?${Object.entries(r.params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}` : '';
    return `${r.path}${q}`;
  } catch {
    return path;
  }
}
