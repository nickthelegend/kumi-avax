// The gas request digest the phone signs must be the one KumiGasStation checks on Fuji.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { recoverMessageAddress, type Address } from 'viem';
import { DEPLOYMENT, client, gasDigest, gasStationAbi } from '../src/index.ts';

const pub = client() as any;
const STATION = DEPLOYMENT.gasStation as Address;

test('gasDigest matches KumiGasStation.digest on Fuji, and a phone signature recovers to the wallet', { timeout: 60_000 }, async () => {
  const acct = privateKeyToAccount(generatePrivateKey());
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  const onChain = await pub.readContract({ address: STATION, abi: gasStationAbi, functionName: 'digest', args: [acct.address, deadline] });
  assert.equal(gasDigest(STATION, acct.address, deadline), onChain);
  const sig = await acct.signMessage({ message: { raw: onChain } });
  assert.equal(await recoverMessageAddress({ message: { raw: onChain }, signature: sig }), acct.address);
});

test('the live station: relayer is Kumi sponsor, 0.0002 AVAX per drip, caps set', { timeout: 60_000 }, async () => {
  const [relayer, amount, cap, perTag, room] = await Promise.all([
    pub.readContract({ address: STATION, abi: gasStationAbi, functionName: 'relayer' }),
    pub.readContract({ address: STATION, abi: gasStationAbi, functionName: 'dripAmount' }),
    pub.readContract({ address: STATION, abi: gasStationAbi, functionName: 'dailyCap' }),
    pub.readContract({ address: STATION, abi: gasStationAbi, functionName: 'perTagDaily' }),
    pub.readContract({ address: STATION, abi: gasStationAbi, functionName: 'room', args: ['0x' + '00'.repeat(32)] }),
  ]);
  assert.equal(relayer.toLowerCase(), DEPLOYMENT.gasSponsor!.toLowerCase());
  assert.equal(amount, 2n * 10n ** 14n);
  assert.equal(cap, 20);
  assert.equal(perTag, 3);
  assert.ok(room[2] > 0n, 'station is funded');
});
