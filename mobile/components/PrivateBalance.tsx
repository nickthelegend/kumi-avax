import { useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { addressUrl } from '@kumi-avax/sdk';
import { parsePrivate } from '@kumi-avax/sdk/eerc';
import type { Address } from 'viem';
import { Text, TextInput } from './T';
import { Btn, Card, Chip, Notice, Obj, Skeleton, TxLink, st, useBusy, yay } from './ui';
import { Sheet, inp } from './Sheet';
import { C, F } from '../lib/theme';
import { useLive } from '../lib/chain';
import { EERC, fmt, moveIn, moveOut, openPrivate, readPrivate } from '../lib/private';
import { PROVER_WHERE } from '../lib/prover';

/** Wallet tab: the private balance (Ava Labs eERC). Decrypted on this phone; the chain holds only ciphertext. */
export function PrivateBalance({ me, publicUsdc, onTxs }: { me: Address; publicUsdc?: bigint; onTxs: (t: { hash: string; label: string }[]) => void }) {
  const p = useLive(() => readPrivate(me), [me], 12000);
  const act = useBusy();
  const [sheet, setSheet] = useState<null | 'in' | 'out'>(null);
  const [last, setLast] = useState<{ hash: string; label: string }[]>([]);
  const d = p.data;
  const done = (t: { hash: string; label: string }[]) => { onTxs(t); setLast(t); yay(); p.reload(); };
  if (!EERC) return <Notice error>Setup required: this build has no eERC address (deployments/fuji.json).</Notice>;
  return (
    <Card pad={16}>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
        <Obj name="shield" size={58} />
        <View style={{ flex: 1 }}>
          <View style={st.row}><Text style={st.h2}>Private balance</Text><Chip text="eERC" tone="plum" /></View>
          <Text style={{ fontSize: 13, color: C.ink2, lineHeight: 18 }}>Tip callers and pay crewmates without the amount showing on Fuji.</Text>
        </View>
      </View>
      {!d ? <View style={{ marginTop: 12 }}><Skeleton rows={1} height={58} /></View> : (
        <View style={{ marginTop: 12, gap: 12 }}>
          <View style={{ padding: 14, borderRadius: 20, backgroundColor: C.plumSoft, gap: 4 }}>
            <Text style={{ fontSize: 12, color: C.plum3, fontWeight: '700' }}>{d.registered ? 'Decrypted on this phone' : 'Not opened yet'}</Text>
            <Text style={{ fontFamily: F.monoBold, fontSize: 28, color: C.plum }}>{fmt(d.balance)} <Text style={{ fontSize: 14, color: C.plum3 }}>tUSDC</Text></Text>
            <Text style={{ fontSize: 12, color: C.ink2 }}>{d.fingerprint ? <>On Snowtrace it is ciphertext <Text style={{ fontFamily: F.mono }}>{d.fingerprint}</Text></> : 'Nothing on chain yet.'}</Text>
          </View>
          {!d.registered ? (
            <Btn testID="open-private" title={act.busy ? `${act.busy}…` : 'Open private balance'} tone="plum" icon="lock" busy={act.busy !== null}
              onPress={() => act.run('Starting', async step => done([await openPrivate(step)]))} />
          ) : (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Btn testID="private-in" title="Move in" tone="butter" icon="plus" onPress={() => setSheet('in')} style={{ flex: 1 }} />
              <Btn testID="private-out" title="Move out" tone="white" icon="exit" disabled={d.balance === 0n} onPress={() => setSheet('out')} style={{ flex: 1 }} />
            </View>
          )}
          {act.busy && <Text style={{ fontSize: 12.5, color: C.ink2, fontWeight: '600' }}>{act.busy}…</Text>}
          {act.error && <Notice error>{act.error}</Notice>}
          {p.error && <Notice error>Could not read the private balance: {p.error}</Notice>}
          {last.length > 0 && !act.busy && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{last.map(t => <TxLink key={t.hash} hash={t.hash} label={t.label} />)}</View>}
          <Text style={{ fontSize: 11.5, color: C.ink3, lineHeight: 16 }}>
            {d.registered ? '' : 'Opening registers your key (one Fuji tx). '}
            Moves in and out are public; sends inside are not.{' '}
            <Text onPress={() => Linking.openURL(addressUrl(EERC!))} style={{ color: C.coralInk, fontWeight: '700' }}>The eERC on Snowtrace</Text>
          </Text>
        </View>
      )}
      {sheet && d && <MoveSheet dir={sheet} privateBal={d.balance} publicUsdc={publicUsdc} onClose={() => setSheet(null)} onDone={done} />}
    </Card>
  );
}

function MoveSheet({ dir, privateBal, publicUsdc, onClose, onDone }: { dir: 'in' | 'out'; privateBal: bigint; publicUsdc?: bigint; onClose: () => void; onDone: (t: { hash: string; label: string }[]) => void }) {
  const [amount, setAmount] = useState(dir === 'in' ? '20.00' : fmt(privateBal).replace(/,/g, ''));
  const act = useBusy();
  const units = parsePrivate(amount);
  const max = dir === 'in' ? (publicUsdc ?? 0n) / 10_000n : privateBal;
  const problem = units === null || units === 0n ? 'Enter an amount in tUSDC, like 20.00.' : units > max ? `You have ${fmt(max)} tUSDC ${dir === 'in' ? 'in the wallet' : 'private'}.` : null;
  return (
    <Sheet title={dir === 'in' ? 'Move tUSDC in' : 'Move tUSDC out'} onClose={onClose}>
      <View style={{ gap: 6 }}>
        <View style={st.between}><Text style={st.k}>Amount (tUSDC)</Text><Pressable onPress={() => setAmount(fmt(max).replace(/,/g, ''))}><Text style={{ fontFamily: F.mono, fontSize: 12, color: C.coralInk }}>max {fmt(max)}</Text></Pressable></View>
        <TextInput testID="move-amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" style={inp} />
      </View>
      <Notice>{dir === 'in' ? 'This amount is public: tUSDC moves from your wallet into the eERC contract. After that, what you send inside Kumi is private.' : `This amount is public: tUSDC comes back to your wallet. The proof is made ${PROVER_WHERE}.`}</Notice>
      {(act.error || problem) && <Notice error>{act.error ?? problem}</Notice>}
      <Btn testID="confirm-move" title={act.busy ? `${act.busy}…` : `Move ${units ? fmt(units) : ''} ${dir}`} tone={dir === 'in' ? 'butter' : 'plum'} size="lg" busy={act.busy !== null} disabled={!!problem}
        onPress={() => act.run('Starting', async step => { const t = dir === 'in' ? await moveIn(units!, step) : [await moveOut(units!, step)]; onDone(t); onClose(); })} />
    </Sheet>
  );
}
