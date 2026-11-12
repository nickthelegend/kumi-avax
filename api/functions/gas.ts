import { bodyOf, cors, ipOf, send, type Req, type Res } from '../src/http.ts';
import { handleGas } from '../src/gas.ts';
import { fujiClient } from '../src/pub.ts';

export default async function handler(req: Req, res: Res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return send(res, { status: 405, body: { error: 'POST { address, deadline, signature }' } });
  try {
    send(res, await handleGas(await bodyOf(req), ipOf(req), process.env, fujiClient()));
  } catch (e) {
    send(res, { status: 500, body: { error: `Kumi's gas sponsor failed: ${(e as Error).message.split('\n')[0]}` } });
  }
}
