/**
 * POST /api/gas { address, deadline, signature }: Kumi's gas sponsor. Checks the request off-chain first (cheap,
 * readable errors), then relays it to KumiGasStation, which checks everything again and enforces the caps on-chain.
 */
import { createWalletClient, formatEther, isAddress, isHex, recoverMessageAddress, type Address, type Hex, type PublicClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { DEPLOYMENT, fuji, fujiTransport, gasDigest, gasStationAbi } from '@kumi-avax/sdk';
import { Limiter, setup, tagOf, type Reply } from './http.ts';

export const STATION = DEPLOYMENT.gasStation as Address;
const perIp = new Limiter(6, 60 * 60_000); // off-chain first line; the station allows 3 per requester per day
let queue: Promise<unknown> = Promise.resolve(); // one relayer key: send its txs one at a time

const WHY: Record<string, Reply> = {
  AlreadyDripped: { status: 409, body: { error: 'This wallet already got its first sip of gas from Kumi.' } },
  NotNew: { status: 409, body: { error: 'This wallet already has Fuji AVAX, so it does not need Kumi\'s gas.' } },
  NotWallet: { status: 400, body: { error: 'That address is a contract, not a phone wallet.' } },
  BadSignature: { status: 401, body: { error: 'The signature is not from this wallet.' } },
  Expired: { status: 400, body: { error: 'The request expired. Try again.' } },
  DeadlineTooFar: { status: 400, body: { error: 'The request deadline is too far ahead (max 1 hour).' } },
  DailyCapReached: { status: 429, body: { error: 'Kumi\'s gas sponsor has given out today\'s drips. Try again tomorrow (UTC), or use the Fuji faucet.' } },
  TagCapReached: { status: 429, body: { error: 'This network already got 3 drips today. Try again tomorrow (UTC), or use the Fuji faucet.' } },
  Empty: setup('Kumi\'s gas sponsor is empty. Top up KumiGasStation on Fuji.'),
};

export type GasEnv = { KUMI_SPONSOR_KEY?: string; KUMI_TAG_SECRET?: string };

export async function handleGas(body: any, ip: string, env: GasEnv, pub: PublicClient): Promise<Reply> {
  if (!env.KUMI_SPONSOR_KEY || !env.KUMI_TAG_SECRET) return setup('KUMI_SPONSOR_KEY and KUMI_TAG_SECRET on the API.');
  if (!STATION) return setup('KumiGasStation is not deployed.');
  const address = body?.address;
  const signature = body?.signature;
  let deadline: bigint;
  try { deadline = BigInt(body?.deadline); } catch { return { status: 400, body: { error: 'deadline must be a unix time in seconds.' } }; }
  if (typeof address !== 'string' || !isAddress(address)) return { status: 400, body: { error: 'address must be a Fuji (EVM) address.' } };
  if (typeof signature !== 'string' || !isHex(signature) || signature.length !== 132) return { status: 400, body: { error: 'signature must be a 65-byte hex signature.' } };
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (deadline < now) return WHY.Expired!;
  if (deadline > now + 3600n) return WHY.DeadlineTooFar!;

  const digest = gasDigest(STATION, address as Address, deadline);
  const signer = await recoverMessageAddress({ message: { raw: digest }, signature: signature as Hex }).catch(() => null);
  if (!signer || signer.toLowerCase() !== address.toLowerCase()) return WHY.BadSignature!;

  const lim = perIp.take(ip);
  if (!lim.ok) return { status: 429, body: { error: `Too many gas requests from this network. Try again in ${Math.ceil(lim.retryS / 60)} min.` } };

  const sponsor = privateKeyToAccount(env.KUMI_SPONSOR_KEY as Hex);
  const tag = tagOf(ip, env.KUMI_TAG_SECRET);
  const [dripped, bal, code, room, relayerBal, relayer, amount] = await Promise.all([
    pub.readContract({ address: STATION, abi: gasStationAbi, functionName: 'dripped', args: [address as Address] }),
    pub.getBalance({ address: address as Address }),
    pub.getCode({ address: address as Address }),
    pub.readContract({ address: STATION, abi: gasStationAbi, functionName: 'room', args: [tag] }),
    pub.getBalance({ address: sponsor.address }),
    pub.readContract({ address: STATION, abi: gasStationAbi, functionName: 'relayer' }),
    pub.readContract({ address: STATION, abi: gasStationAbi, functionName: 'dripAmount' }),
  ]);
  if (relayer.toLowerCase() !== sponsor.address.toLowerCase()) return setup('the API\'s KUMI_SPONSOR_KEY is not the station\'s relayer.');
  if (dripped) return WHY.AlreadyDripped!;
  if (bal > 0n) return WHY.NotNew!;
  if (code && code !== '0x') return WHY.NotWallet!;
  if (room[2] === 0n) return WHY.Empty!;
  if (room[0] === 0n) return WHY.DailyCapReached!;
  if (room[1] === 0n) return WHY.TagCapReached!;
  if (relayerBal < 10n ** 12n) return setup('Kumi\'s gas relayer key has no AVAX left for its own gas.');

  const run = async (): Promise<Reply> => {
    try {
      const args = [address as Address, deadline, signature as Hex, tag] as const;
      const { request } = await pub.simulateContract({ account: sponsor, address: STATION, abi: gasStationAbi, functionName: 'drip', args });
      const wallet = createWalletClient({ account: sponsor, chain: fuji, transport: fujiTransport() });
      const hash = await wallet.writeContract(request);
      const r = await pub.waitForTransactionReceipt({ hash, pollingInterval: 400, timeout: 45_000 });
      if (r.status !== 'success') return { status: 502, body: { error: `The drip reverted on Fuji: ${hash}` } };
      return { status: 200, body: { hash, amount: formatEther(amount), left: { today: Number(room[0]) - 1, funded: Number(room[2]) - 1 } } };
    } catch (e) {
      const named = (e as any)?.walk?.((x: any) => !!x?.data?.errorName)?.data?.errorName as string | undefined;
      if (named && WHY[named]) return WHY[named]!;
      return { status: 502, body: { error: `Fuji refused the drip: ${((e as any)?.shortMessage ?? (e as Error).message).split('\n')[0]}` } };
    }
  };
  const p = queue.then(run, run);
  queue = p.catch(() => undefined);
  return p;
}
