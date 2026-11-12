import type { Address } from 'viem';
import { DEPLOYMENT, readLeaderboard, type Leaderboard } from '@kumi-avax/sdk';
import { LOBBY, PERPS, pub, useLive } from './chain';

let last: { at: number; p: Promise<Leaderboard> } | null = null;
/** The caller board from Fuji, shared by every screen (one read per 20 s; fill history is cached incrementally). */
export function readBoard(): Promise<Leaderboard> {
  if (!last || Date.now() - last.at > 20_000) {
    const p = readLeaderboard(pub as any, { lobby: LOBBY, perps: PERPS, fromBlock: BigInt(DEPLOYMENT.perpsDeployBlock) });
    last = { at: Date.now(), p };
    p.catch(() => { last = null; });
  }
  return last.p;
}
export const useBoard = () => useLive(readBoard, [], 30_000);
export type { Address };
