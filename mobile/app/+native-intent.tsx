import { routeForSystemPath } from '../lib/links';

/**
 * Kumi links opened from outside the app (a friend's message, the camera): kumi://join/<chat> opens that chat, and a
 * join code kumi://invite/<crew>/<address> opens the crew with `/invite <address>` drafted for the crew to vote on.
 * iOS hands the URL over as `kumi:///invite/…` (three slashes); lib/links.ts normalises it (unit-tested).
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string | null {
  try {
    return routeForSystemPath(path) ?? path;
  } catch {
    return path;
  }
}
