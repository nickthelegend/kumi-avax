import { marketBySymbol } from './markets.ts';

export type Command =
  | { kind: 'open'; market: number; symbol: string; isLong: boolean; leverage: number; sizeBps: number; defaultedSize: boolean; captain: boolean }
  | { kind: 'close'; market: number; symbol: string; sizeBps: number; captain: boolean }
  | { kind: 'invite'; address: `0x${string}` }
  | { kind: 'captain'; address: `0x${string}` | null };

export type Parsed = { ok: true; cmd: Command } | { ok: false; error: string } | null;

export const DEFAULT_SIZE_BPS = 2000;

/** Parses a chat command. Returns null for plain chat, or an error a person can act on. */
export function parseCommand(input: string, maxLeverage = 5): Parsed {
  const t = input.trim().replace(/\s+/g, ' ');
  if (!t.startsWith('/')) return null;
  const parts = t.slice(1).split(' ');
  let captain = false;
  if (parts[0]?.toLowerCase() === 'captain' && parts.length > 1 && !parts[1]!.startsWith('0x') && parts[1] !== 'none') { captain = true; parts.shift(); }
  const verb = parts[0]?.toLowerCase();
  if (verb === 'long' || verb === 'short') {
    const m = marketBySymbol(parts[1] ?? '');
    if (!m) return { ok: false, error: `Which market? Try /${verb} AVAX 3x 20% or /${verb} BTC 2x 10%.` };
    const lev = /^(\d+)x$/i.exec(parts[2] ?? '');
    if (!lev) return { ok: false, error: `Add leverage, like /${verb} ${m.symbol} 3x 20%.` };
    const leverage = Number(lev[1]);
    if (leverage < 1 || leverage > maxLeverage) return { ok: false, error: `This crew allows 1x to ${maxLeverage}x.` };
    let sizeBps = DEFAULT_SIZE_BPS;
    let defaultedSize = true;
    if (parts[3] !== undefined) {
      const pct = /^(\d+(?:\.\d+)?)%$/.exec(parts[3]);
      if (!pct) return { ok: false, error: 'Size is a share of the fund, like 20%.' };
      sizeBps = Math.round(Number(pct[1]) * 100);
      defaultedSize = false;
      if (sizeBps < 1 || sizeBps > 10000) return { ok: false, error: 'Size must be between 0.01% and 100% of the fund.' };
    }
    if (parts.length > 4) return { ok: false, error: `Too many words. Try /${verb} ${m.symbol} ${leverage}x 20%.` };
    return { ok: true, cmd: { kind: 'open', market: m.id, symbol: m.symbol, isLong: verb === 'long', leverage, sizeBps, defaultedSize, captain } };
  }
  if (verb === 'close') {
    const m = marketBySymbol(parts[1] ?? '');
    if (!m) return { ok: false, error: 'Which position? Try /close AVAX or /close BTC 50%.' };
    let sizeBps = 10000;
    if (parts[2] !== undefined) {
      const pct = /^(\d+(?:\.\d+)?)%$/.exec(parts[2]);
      if (!pct) return { ok: false, error: 'Close a share of the position, like /close AVAX 50%.' };
      sizeBps = Math.round(Number(pct[1]) * 100);
      if (sizeBps < 1 || sizeBps > 10000) return { ok: false, error: 'Close between 0.01% and 100%.' };
    }
    return { ok: true, cmd: { kind: 'close', market: m.id, symbol: m.symbol, sizeBps, captain } };
  }
  if (verb === 'invite') {
    const a = parts[1] ?? '';
    if (!/^0x[0-9a-fA-F]{40}$/.test(a)) return { ok: false, error: 'Invite an address: /invite 0x…' };
    return { ok: true, cmd: { kind: 'invite', address: a as `0x${string}` } };
  }
  if (verb === 'captain') {
    const a = parts[1] ?? '';
    if (a === 'none') return { ok: true, cmd: { kind: 'captain', address: null } };
    if (!/^0x[0-9a-fA-F]{40}$/.test(a)) return { ok: false, error: 'Name a captain: /captain 0x… (or /captain none)' };
    return { ok: true, cmd: { kind: 'captain', address: a as `0x${string}` } };
  }
  return { ok: false, error: 'Commands: /long AVAX 3x 20%, /short BTC 2x 10%, /close AVAX, /invite 0x…, /captain 0x…' };
}

/** The canonical text of a command, as the trade card shows it. */
export function describe(cmd: Command): string {
  if (cmd.kind === 'open') return `/${cmd.isLong ? 'long' : 'short'} ${cmd.symbol} ${cmd.leverage}x ${cmd.sizeBps / 100}%`;
  if (cmd.kind === 'close') return `/close ${cmd.symbol}${cmd.sizeBps < 10000 ? ` ${cmd.sizeBps / 100}%` : ''}`;
  if (cmd.kind === 'invite') return `/invite ${cmd.address}`;
  return `/captain ${cmd.address ?? 'none'}`;
}
