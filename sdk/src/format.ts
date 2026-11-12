import { PX, SIZE, USD } from './markets.ts';

const fix = (v: bigint, scale: bigint, dp: number) => {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const unit = 10n ** BigInt(dp);
  const r = (a * unit + scale / 2n) / scale;
  const int = r / unit;
  const frac = (r % unit).toString().padStart(dp, '0');
  const s = int.toLocaleString('en-US') + (dp > 0 ? `.${frac}` : '');
  return neg && r !== 0n ? `-${s}` : s;
};
export const usd = (v: bigint, dp = 2) => fix(v, USD, dp);
export const price = (v: bigint, dp = 2) => fix(v, PX, dp);
export const size = (v: bigint, dp = 2) => fix(v, SIZE, dp);
export const signedUsd = (v: bigint, dp = 2) => `${v > 0n ? '+' : ''}${usd(v, dp)}`;
export const pct = (num: bigint, den: bigint, dp = 2) => (den === 0n ? '0.00' : (Number((num * 1_000_000n) / den) / 10_000).toFixed(dp));
export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
