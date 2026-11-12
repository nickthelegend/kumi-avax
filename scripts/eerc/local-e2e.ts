/**
 * End-to-end test of Kumi's private balance and private sends on a local Anvil chain: Kumi's TestUSDC, Ava Labs'
 * EncryptedERC (converter mode, production verifiers, pinned submodule) and real Groth16 proofs from the shipped
 * zkeys. No mocks, no stub verifiers, no mocked RPC.
 *
 *   pnpm --filter @kumi-avax/scripts test:eerc
 *
 * Covers the happy path (register, shield, a private tip with a Kumi memo, reading it back as the receiver, the
 * sender, the auditor and a stranger, move out) and the attacks the chain must refuse: stolen, cross-chain, forged,
 * replayed and tampered proofs, and over-spending.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { createPublicClient, createWalletClient, decodeErrorResult, decodeFunctionData, defineChain, encodeFunctionData, http, type Abi, type Address, type Hex, type PrivateKeyAccount } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { usdcAbi } from '@kumi-avax/sdk';
import {
  auditorKey, buildMemo, contractProof, decodeMemo, decryptBalance, encryptedErcAbi, privateAmountFor, privateChatText, privateTxOf,
  readPrivateSend, registrarAbi, registrationInput, transferInput, withdrawInput, NO_REF,
} from '@kumi-avax/sdk/eerc';
import { ROOT } from '../fuji/env.ts';
import { balanceOf, closeProver, deployVault, nodeProver, openKey, register, send, sendPrivately, shield, unshield, type Ctx } from './vault.ts';

const PORT = 5346;
const RPC = `http://127.0.0.1:${PORT}`;
const chain = defineChain({ id: 31337, name: 'anvil', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
// Anvil's public development mnemonic: local chain only.
const dev = (i: number) => mnemonicToAccount('test test test test test test test test test test test junk', { addressIndex: i }) as unknown as PrivateKeyAccount;
const [owner, auditor, mira, kai, stranger] = [0, 1, 2, 3, 4].map(dev) as PrivateKeyAccount[];
const LOBBY = '0x86c916ab60f186a43ab6b31603d91641dc228e7a' as Address; // only used as the memo's venue label here

let checks = 0;
const ok = (name: string) => { checks += 1; console.log(`  ✔ ${name}`); };

async function reverts(ctx: Ctx, who: PrivateKeyAccount, to: Address, abi: Abi, fn: string, args: readonly unknown[], expect: RegExp, name: string) {
  const data = encodeFunctionData({ abi, functionName: fn, args } as never);
  const err = await ctx.pub.call({ account: who.address, to, data }).then(() => null, (e: Error) => e);
  assert.ok(err, `${name}: expected a revert`);
  const raw = /custom error (0x[0-9a-f]{8})/.exec(err!.message)?.[1] ?? (err as { data?: Hex }).data;
  let decoded = '';
  if (raw) { try { decoded = decodeErrorResult({ abi: [...(encryptedErcAbi as Abi), ...(registrarAbi as Abi), ...(abi as Abi)], data: raw as Hex }).errorName; } catch { decoded = String(raw); } }
  const text = `${decoded} ${(err as { shortMessage?: string }).shortMessage ?? ''} ${err!.message}`;
  assert.match(text, expect, `${name}: wrong reason: ${text.slice(0, 300)}`);
  ok(name);
}

const anvil = spawn('anvil', ['--port', String(PORT), '--silent', '--code-size-limit', '30000'], { stdio: 'ignore' });
const stop = () => { try { anvil.kill('SIGKILL'); } catch { /* gone */ } };
process.on('exit', stop);

try {
  const pub = createPublicClient({ chain, transport: http(RPC), pollingInterval: 50 });
  for (let i = 0; ; i += 1) { try { await pub.getBlockNumber(); break; } catch { if (i > 50) throw Error('anvil did not start'); await new Promise((r) => setTimeout(r, 200)); } }
  const ctx: Ctx = { pub: pub as never, chain, transport: () => http(RPC), log: [] };
  const bal = (a: Address) => pub.readContract({ address: usdc, abi: usdcAbi, functionName: 'balanceOf', args: [a] });

  console.log('Kumi TestUSDC');
  const t = JSON.parse(readFileSync(join(ROOT, 'contracts/out/TestUSDC.sol/TestUSDC.json'), 'utf8'));
  const w = createWalletClient({ account: owner, chain, transport: http(RPC) });
  const usdc = (await pub.waitForTransactionReceipt({ hash: await w.deployContract({ abi: usdcAbi, bytecode: t.bytecode.object as Hex }) })).contractAddress!;
  for (const who of [mira, kai, stranger]) await send(ctx, owner, usdc, usdcAbi as Abi, 'mint', [who.address, 100_000_000n], `mint 100 tUSDC`);
  ok('mira, kai and a stranger hold 100 public tUSDC each');

  console.log('EncryptedERC converter, production verifiers, 2 decimals');
  const v = await deployVault(ctx, owner);
  assert.equal(await pub.readContract({ address: v.encryptedERC, abi: encryptedErcAbi, functionName: 'isConverter' }), true);
  assert.equal(await pub.readContract({ address: v.encryptedERC, abi: encryptedErcAbi, functionName: 'decimals' }), 2);
  ok('EncryptedERC deployed in converter mode at 2 decimals');

  const kMira = await openKey(mira, chain.id);
  const kKai = await openKey(kai, chain.id);
  const kAud = await openKey(auditor, chain.id);
  const kStranger = await openKey(stranger, chain.id);
  assert.deepEqual(kMira.publicKey, (await openKey(mira, chain.id)).publicKey);
  ok('the same wallet signature reopens the same eERC key');

  console.log('Registration and its attacks');
  const regMira = await nodeProver('registration', registrationInput(kMira, mira.address, chain.id));
  await reverts(ctx, kai, v.registrar, registrarAbi as Abi, 'register', [contractProof(regMira.proof, regMira.publicSignals)], /InvalidSender/, "kai cannot register with mira's proof");
  const wrongChain = await nodeProver('registration', registrationInput(kMira, mira.address, 43113));
  await reverts(ctx, mira, v.registrar, registrarAbi as Abi, 'register', [contractProof(wrongChain.proof, wrongChain.publicSignals)], /InvalidChainId/, 'a registration proof for Fuji is refused on another chain');
  const forged = contractProof(regMira.proof, regMira.publicSignals);
  forged.publicSignals[0] = kKai.publicKey[0];
  forged.publicSignals[1] = kKai.publicKey[1];
  await reverts(ctx, mira, v.registrar, registrarAbi as Abi, 'register', [forged], /InvalidProof|revert/, 'a registration proof with a swapped public key is refused');
  await send(ctx, mira, v.registrar, registrarAbi as Abi, 'register', [contractProof(regMira.proof, regMira.publicSignals)], 'mira registers');
  await reverts(ctx, mira, v.registrar, registrarAbi as Abi, 'register', [contractProof(regMira.proof, regMira.publicSignals)], /UserAlreadyRegistered/, 'registering twice is refused');

  await send(ctx, mira, usdc, usdcAbi as Abi, 'approve', [v.encryptedERC, 100_000_000n], 'mira approves the eERC');
  await reverts(ctx, mira, v.encryptedERC, encryptedErcAbi as Abi, 'deposit', [50_000_000n, usdc, Array(7).fill(0n)], /Auditor public key not set|AuditorKeyNotSet|revert/, 'nothing can be shielded before an auditor is set');
  await register(ctx, v, auditor, kAud, nodeProver, 'auditor registers');
  await reverts(ctx, stranger, v.encryptedERC, encryptedErcAbi as Abi, 'setAuditorPublicKey', [stranger.address], /OwnableUnauthorizedAccount|revert/, 'only the owner sets the auditor');
  await send(ctx, owner, v.encryptedERC, encryptedErcAbi as Abi, 'setAuditorPublicKey', [auditor.address], 'owner sets the auditor');
  assert.deepEqual((await auditorKey(pub as never, v.encryptedERC)).publicKey, kAud.publicKey);
  ok("the auditor's public key is on chain");

  console.log('Shield');
  await reverts(ctx, stranger, v.encryptedERC, encryptedErcAbi as Abi, 'deposit', [1_000_000n, usdc, Array(7).fill(0n)], /UserNotRegistered/, 'an unregistered account cannot shield');
  await shield(ctx, v, mira, kMira, usdc, 5000n, 'mira shields 50.00 tUSDC');
  assert.equal(await bal(v.encryptedERC), 50_000_000n);
  assert.equal(await bal(mira.address), 50_000_000n);
  ok('public view: the eERC contract holds 50 tUSDC, mira 50 (shield amounts are public)');
  let m = await balanceOf(ctx, v, mira.address, kMira, usdc);
  assert.equal(m.balance, 5000n);
  ok("mira's own key decrypts 50.00 private");
  assert.throws(() => decryptBalance(kKai, m.b));
  ok("kai's key cannot open mira's private balance");
  // Odd amounts: the converter keeps whole cents and returns the rest.
  await send(ctx, mira, v.encryptedERC, encryptedErcAbi as Abi, 'deposit', [1_234_567n, usdc, (await import('@kumi-avax/sdk/eerc')).depositPct(kMira, 123n)], 'mira shields 1.234567 tUSDC');
  assert.equal(await bal(mira.address), 50_000_000n - 1_230_000n);
  assert.equal((await balanceOf(ctx, v, mira.address, kMira, usdc)).balance, 5123n);
  ok('shielding 1.234567 keeps 1.23 private and returns 0.004567 dust');

  console.log('A private tip on a call');
  await reverts(ctx, mira, v.encryptedERC, encryptedErcAbi as Abi, 'transfer', [kai.address, m.id, { proofPoints: { a: [0n, 0n], b: [[0n, 0n], [0n, 0n]], c: [0n, 0n] }, publicSignals: Array(32).fill(0n) }, Array(7).fill(0n)], /UserNotRegistered|revert/, 'nobody can send to a member who has not opened a private balance');
  await register(ctx, v, kai, kKai, nodeProver, 'kai registers');
  const memo = { kind: 'tip' as const, venue: LOBBY, channel: 0n, ref: 7n };
  const tip = await sendPrivately(ctx, v, mira, kMira, usdc, kai.address, 250n, memo, nodeProver, 'mira tips kai 2.50 for call #7');
  assert.equal((await balanceOf(ctx, v, mira.address, kMira, usdc)).balance, 4873n);
  const k = await balanceOf(ctx, v, kai.address, kKai, usdc);
  assert.equal(k.balance, 250n);
  ok('after the tip: mira 48.73, kai 2.50, each read with their own key');
  assert.equal(await bal(v.encryptedERC), 51_230_000n);
  ok('no public tUSDC moved: the eERC still holds 51.23');
  const tx = await pub.getTransaction({ hash: tip.hash });
  assert.ok(!tx.input.includes((250n).toString(16).padStart(64, '0')) && !tx.input.includes((2_500_000n).toString(16).padStart(64, '0')));
  ok('the amount appears nowhere in the transfer calldata');

  const sendRead = await readPrivateSend(pub as never, v.encryptedERC, tip.hash, mira.address);
  assert.equal(sendRead.to.toLowerCase(), kai.address.toLowerCase());
  assert.deepEqual({ ...sendRead.memo, venue: sendRead.memo?.venue.toLowerCase(), senderPct: undefined }, { ...memo, senderPct: undefined });
  ok('the memo links the tip to lobby channel 0, call #7');
  assert.equal(privateAmountFor(sendRead, kai.address, kKai), 250n);
  ok('the receiver decrypts 2.50 from the transfer');
  assert.equal(privateAmountFor(sendRead, mira.address, kMira), 250n);
  ok("the sender decrypts 2.50 from the memo's own copy");
  assert.equal(privateAmountFor(sendRead, undefined, undefined, kAud), 250n);
  ok("the auditor decrypts 2.50 from eERC's auditor copy");
  assert.equal(privateAmountFor(sendRead, stranger.address, kStranger), null);
  assert.equal(privateAmountFor(sendRead, undefined, undefined, kStranger), null);
  ok('a stranger, with or without an eERC key, sees "amount hidden"');
  await assert.rejects(readPrivateSend(pub as never, v.encryptedERC, tip.hash, kai.address), /someone other than the sender/);
  ok('a chat card posted by someone other than the sender is rejected');
  await assert.rejects(readPrivateSend(pub as never, usdc, tip.hash, mira.address), /another contract/);
  ok('a transaction on another contract is not a private send');
  assert.equal(privateTxOf(privateChatText(tip.hash)), tip.hash.toLowerCase());
  assert.equal(privateTxOf(`${privateChatText(tip.hash)} extra`), null);
  ok('the chat text round-trips to the transaction hash and nothing else');

  console.log('Attacks on private sends');
  const replay = decodeFunctionData({ abi: encryptedErcAbi as Abi, data: tx.input });
  await reverts(ctx, mira, v.encryptedERC, encryptedErcAbi as Abi, 'transfer', replay.args as unknown[], /InvalidProof|InvalidBalance|revert/, 'replaying the same transfer proof is refused');
  await reverts(ctx, kai, v.encryptedERC, encryptedErcAbi as Abi, 'transfer', replay.args as unknown[], /InvalidProof|InvalidSender|InvalidPublicKey|revert/, "kai cannot submit mira's transfer proof");
  const mNow = await balanceOf(ctx, v, mira.address, kMira, usdc);
  const aud = await auditorKey(pub as never, v.encryptedERC);
  const fresh = transferInput(kMira, mNow.balance, mNow.b, kKai.publicKey, 100n, aud.publicKey);
  const fp = await nodeProver('transfer', fresh.input);
  const msg = buildMemo(kMira, 'tip', LOBBY, 0n, 7n, 100n);
  const toStranger = contractProof(fp.proof, fp.publicSignals);
  await reverts(ctx, mira, v.encryptedERC, encryptedErcAbi as Abi, 'transfer', [stranger.address, mNow.id, toStranger, fresh.balancePCT, msg], /UserNotRegistered|InvalidPublicKey|revert/, "a proof made for kai cannot be redirected to someone else");
  const bumped = contractProof(fp.proof, fp.publicSignals);
  bumped.publicSignals[16] = bumped.publicSignals[16]! + 1n; // receiver's readable amount copy
  await reverts(ctx, mira, v.encryptedERC, encryptedErcAbi as Abi, 'transfer', [kai.address, mNow.id, bumped, fresh.balancePCT, msg], /InvalidProof|revert/, 'a transfer proof with a tampered public signal is refused');
  const badPoint = contractProof(fp.proof, fp.publicSignals);
  badPoint.proofPoints.a = [badPoint.proofPoints.a[0], badPoint.proofPoints.a[1] + 1n];
  await reverts(ctx, mira, v.encryptedERC, encryptedErcAbi as Abi, 'transfer', [kai.address, mNow.id, badPoint, fresh.balancePCT, msg], /InvalidProof|revert/, 'a transfer proof with a tampered curve point is refused');
  const over = transferInput(kMira, 999_999n, mNow.b, kKai.publicKey, 999_000n, aud.publicKey);
  await assert.rejects(nodeProver('transfer', over.input));
  ok('no transfer proof exists for sending more than the encrypted balance');

  console.log('Move out and its attacks');
  const wIn = withdrawInput(kKai, 250n, k.b, 100n, aud.publicKey);
  const wProof = await nodeProver('withdraw', wIn.input);
  const wCall = contractProof(wProof.proof, wProof.publicSignals);
  await reverts(ctx, mira, v.encryptedERC, encryptedErcAbi as Abi, 'withdraw', [k.id, wCall, wIn.balancePCT], /InvalidProof|InvalidSender|InvalidPublicKey|revert/, "mira cannot submit kai's withdraw proof");
  const raised = contractProof(wProof.proof, wProof.publicSignals);
  raised.publicSignals[0] = 250n; // ValueToWithdraw
  await reverts(ctx, kai, v.encryptedERC, encryptedErcAbi as Abi, 'withdraw', [k.id, raised, wIn.balancePCT], /InvalidProof|revert/, 'a withdraw proof with a raised amount is refused');
  await assert.rejects(nodeProver('withdraw', withdrawInput(kKai, 5000n, k.b, 4000n, aud.publicKey).input));
  ok('no withdraw proof exists for more than the encrypted balance');
  const kaiBefore = await bal(kai.address);
  await send(ctx, kai, v.encryptedERC, encryptedErcAbi as Abi, 'withdraw', [k.id, wCall, wIn.balancePCT], 'kai moves 1.00 out');
  await reverts(ctx, kai, v.encryptedERC, encryptedErcAbi as Abi, 'withdraw', [k.id, wCall, wIn.balancePCT], /InvalidProof|InvalidBalance|revert/, 'replaying a withdraw proof is refused');
  assert.equal(await bal(kai.address) - kaiBefore, 1_000_000n);
  assert.equal((await balanceOf(ctx, v, kai.address, kKai, usdc)).balance, 150n);
  ok('kai: +1.00 public tUSDC, 1.50 still private');
  await unshield(ctx, v, mira, kMira, usdc, 4873n, nodeProver, 'mira moves everything out');
  assert.equal((await balanceOf(ctx, v, mira.address, kMira, usdc)).balance, 0n);
  assert.equal(await bal(mira.address), 100_000_000n - 2_500_000n);
  ok('an emptied private balance decrypts to 0, and mira is down exactly the 2.50 tip');
  assert.equal(NO_REF, (1n << 64n) - 1n);
  assert.equal(decodeMemo('0x1234'), null);
  ok('a non-Kumi memo decodes to null');

  console.log(`\neERC local end-to-end: ${checks}/${checks} checks passed, ${ctx.log.length} transactions`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await closeProver();
  stop();
  process.exit(process.exitCode ?? 0);
}
