/**
 * Gas-free start (v2.2). A brand-new wallet signs a request; Kumi's API relays it to KumiGasStation on Fuji, which
 * checks the signature, pays 0.0002 AVAX once, and keeps the daily and per-requester caps on-chain.
 * The digest here must match KumiGasStation.digest (tested against the deployed contract).
 */
import { encodePacked, keccak256, type Address, type Hex } from 'viem';

/** Kumi's API (Vercel serverless): the gas sponsor and Kumi AI. Apps may override it with their own env var. */
export const KUMI_API = 'https://kumi-avax-api.vercel.app';

export function gasDigest(station: Address, to: Address, deadline: bigint, chainId = 43113n): Hex {
  return keccak256(encodePacked(['string', 'uint256', 'address', 'address', 'uint256'], ['Kumi gas', chainId, station, to, deadline]));
}

export type GasRequest = { address: Address; deadline: string; signature: Hex };
export type GasResult = { ok: true; hash: Hex; amount: string; left: { today: number; funded: number } } | { ok: false; error: string; setup?: boolean; status: number };

/** Signs and sends a gas request. `sign` signs the raw 32-byte digest (EIP-191), e.g. viem's account.signMessage({ message: { raw } }). */
export async function requestGas(opts: { api?: string; station: Address; address: Address; now: bigint; sign: (raw: Hex) => Promise<Hex> }): Promise<GasResult> {
  const deadline = opts.now + 600n;
  const signature = await opts.sign(gasDigest(opts.station, opts.address, deadline));
  let r: Response;
  try {
    r = await fetch(`${opts.api ?? KUMI_API}/api/gas`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address: opts.address, deadline: deadline.toString(), signature } satisfies GasRequest) });
  } catch (e) {
    return { ok: false, status: 0, error: `Kumi's gas sponsor did not answer (${(e as Error).message}).` };
  }
  const body = await r.json().catch(() => ({ error: `Kumi's gas sponsor answered ${r.status}` }));
  if (!r.ok || !body.hash) return { ok: false, status: r.status, error: body.error ?? `Kumi's gas sponsor answered ${r.status}`, setup: !!body.setup };
  return { ok: true, hash: body.hash, amount: body.amount, left: body.left };
}
