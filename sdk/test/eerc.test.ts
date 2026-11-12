// Kumi's private balance against the live Fuji deployment (Ava Labs EncryptedERC over tUSDC) and the live chats.
// No keys here: these are the checks anyone can run, i.e. what the public can and cannot see.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEPLOYMENT, client, readChannelMessages, readCrewMessages, usdcAbi } from '../src/index.ts';
import {
  auditorKey, ciphertextFingerprint, decodeMemo, encryptedBalance, encryptPct, decryptPct, fmtPrivate, keypairFromSeed, parsePrivate,
  privateAmountFor, readPrivateSend, registeredKey, encryptedErcAbi, toPrivateUnits,
} from '../src/eerc.ts';

const pub = client() as any;
const E = DEPLOYMENT.eerc!;
const EERC = E.encryptedERC as `0x${string}`;
const LOBBY = DEPLOYMENT.lobby as `0x${string}`;
const addrOf = (n: string) => Object.entries(DEPLOYMENT.names as Record<string, string>).find(([, v]) => v === n)![0] as `0x${string}`;

test('units and ciphertexts: cents, PCT round trip, wrong key refused', () => {
  assert.equal(fmtPrivate(123456n), '1,234.56');
  assert.equal(parsePrivate('2.5'), 250n);
  assert.equal(parsePrivate('2.505'), null);
  assert.equal(toPrivateUnits(1_234_567n), 123n);
  const a = keypairFromSeed(123456789n), b = keypairFromSeed(987654321n);
  const { pct } = encryptPct([4200n], a.publicKey);
  assert.equal(decryptPct(a, pct)[0], 4200n);
  assert.throws(() => decryptPct(b, pct));
});

test('Fuji: the eERC is a converter at 2 decimals with the Kumi auditor set', { timeout: 60_000 }, async () => {
  const [isConverter, decimals] = await Promise.all([
    pub.readContract({ address: EERC, abi: encryptedErcAbi, functionName: 'isConverter' }),
    pub.readContract({ address: EERC, abi: encryptedErcAbi, functionName: 'decimals' }),
  ]);
  assert.equal(isConverter, true);
  assert.equal(decimals, 2);
  const aud = await auditorKey(pub, EERC);
  assert.equal(aud.address.toLowerCase(), E.auditor!.toLowerCase());
  assert.deepEqual(aud.publicKey, await registeredKey(pub, E.registrar as `0x${string}`, aud.address));
});

test('Fuji: the public sees the pool total, never a member balance', { timeout: 60_000 }, async () => {
  const pool = await pub.readContract({ address: DEPLOYMENT.usdc as `0x${string}`, abi: usdcAbi, functionName: 'balanceOf', args: [EERC] });
  assert.ok(pool >= 100_000_000n, 'the shields add up to at least 100 tUSDC in the eERC');
  const id = await pub.readContract({ address: EERC, abi: encryptedErcAbi, functionName: 'tokenIds', args: [DEPLOYMENT.usdc] });
  const b = await encryptedBalance(pub, EERC, addrOf('mika'), id);
  assert.notEqual(b.c1[0], 0n, 'mika has an encrypted balance');
  assert.match(ciphertextFingerprint(b), /^[0-9a-f]{8}…[0-9a-f]{6}$/);
  // A key that is not mika's cannot open it (the ElGamal check fails).
  const { decryptBalance } = await import('../src/eerc.ts');
  assert.throws(() => decryptBalance(keypairFromSeed(42n), b));
});

test('Fuji: a private tip in the AVAX pit is a real eERC transfer from the poster to the caller, amount hidden', { timeout: 90_000 }, async () => {
  const msgs = await readChannelMessages(pub, LOBBY, DEPLOYMENT.lobbyChannels.avaxpit, 200);
  const tips = msgs.filter(m => m.kind === 'private');
  assert.ok(tips.length >= 2);
  for (const t of tips) {
    const s = await readPrivateSend(pub, EERC, t.privateTx!, t.who);
    assert.equal(s.memo?.kind, 'tip');
    assert.equal(s.memo?.venue.toLowerCase(), LOBBY.toLowerCase());
    assert.equal(s.memo?.channel, BigInt(DEPLOYMENT.lobbyChannels.avaxpit));
    const call = msgs.find(m => m.index === Number(s.memo!.ref))!;
    assert.equal(call.kind, 'call');
    assert.equal(s.to.toLowerCase(), call.who.toLowerCase(), 'the tip went to the caller');
    assert.equal(privateAmountFor(s, addrOf('tae'), keypairFromSeed(7n)), null, 'a stranger sees no amount');
    const tx = await pub.getTransaction({ hash: t.privateTx! });
    assert.equal(decodeMemo('0x00'), null);
    assert.ok(tx.input.length > 2000, 'the transfer carries a Groth16 proof');
  }
  await assert.rejects(readPrivateSend(pub, EERC, tips[0]!.privateTx!, addrOf('lia')), /someone other than the sender/);
});

test('Fuji: a crew settle-up inside Night Owls points to a private send between two members', { timeout: 60_000 }, async () => {
  const owls = DEPLOYMENT.crews.find(c => c.name === 'Night Owls')!.address as `0x${string}`;
  const items = await readCrewMessages(pub, owls, 200);
  const p = items.find(m => m.kind === 'private')!;
  assert.ok(p);
  const s = await readPrivateSend(pub, EERC, p.privateTx!, p.who);
  assert.equal(s.memo?.kind, 'send');
  assert.equal(s.memo?.venue.toLowerCase(), owls.toLowerCase());
  assert.equal(s.to.toLowerCase(), addrOf('mika'));
});
