import { formatEther } from 'viem';
import { DEPLOYMENT, gasStationAbi } from '@kumi-avax/sdk';
import { cors, send, type Req, type Res } from '../src/http.ts';
import { fujiClient } from '../src/pub.ts';
import { MODEL } from '../src/ask.ts';

/** GET /api/health: what is configured (never the values) and the station's live state on Fuji. */
export default async function handler(req: Req, res: Res) {
  if (cors(req, res)) return;
  const pub = fujiClient();
  const station = DEPLOYMENT.gasStation as `0x${string}`;
  try {
    const [bal, room, total] = await Promise.all([
      pub.getBalance({ address: station }),
      pub.readContract({ address: station, abi: gasStationAbi, functionName: 'room', args: ['0x' + '00'.repeat(32) as `0x${string}`] }),
      pub.readContract({ address: station, abi: gasStationAbi, functionName: 'totalDrips' }),
    ]);
    send(res, { status: 200, body: {
      gas: { configured: !!process.env.KUMI_SPONSOR_KEY && !!process.env.KUMI_TAG_SECRET, station, balanceAvax: formatEther(bal), dripsLeftToday: Number(room[0]), dripsFunded: Number(room[2]), totalDrips: Number(total) },
      ai: { configured: !!process.env.ANTHROPIC_API_KEY, model: MODEL },
    } });
  } catch (e) {
    send(res, { status: 502, body: { error: `Could not read Fuji: ${(e as Error).message.split('\n')[0]}` } });
  }
}
