import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeInDown, ReduceMotion } from 'react-native-reanimated';
import type { Address } from 'viem';
import { NO_REF, parsePrivate } from '@kumi-avax/sdk/eerc';
import type { ChatItem } from '@kumi-avax/sdk';
import { Text, TextInput } from './T';
import { Avatar, Btn, Empty, Ic, Notice, Obj, TxLink, st, tap, useBusy, yay } from './ui';
import { Sheet, inp } from './Sheet';
import { C, F, art } from '../lib/theme';
import { nameOf, useLive } from '../lib/chain';
import { fmt, readCard, readPrivate, sendPrivately, type Where } from '../lib/private';
import { PROVER_WHERE } from '../lib/prover';

const enter = FadeInDown.duration(260).reduceMotion(ReduceMotion.System);

/**
 * A private tip or send in a chat. The card is checked against Fuji (a successful eERC transfer from the poster);
 * the amount shows only on the receiver's and the sender's phones. Everyone else sees that it happened, not how much.
 */
export function PrivateCard({ m, me }: { m: ChatItem; me?: string | null }) {
  const c = useLive(() => readCard(m.privateTx!, m.who as Address, (me ?? null) as Address | null), [m.privateTx, me], 0);
  const mine = !!me && m.who.toLowerCase() === me.toLowerCase();
  const s = c.data?.send;
  const amount = c.data?.amount ?? null;
  const toMe = !!me && !!s && s.to.toLowerCase() === me.toLowerCase();
  const ref = s?.memo && s.memo.ref !== NO_REF ? Number(s.memo.ref) : null;
  if (c.error && !c.data)
    return <Text style={{ alignSelf: 'center', fontSize: 12.5, color: C.pinkInk, textAlign: 'center' }}>{nameOf(m.who, me)} posted a private-send card that does not check out: {c.error}</Text>;
  return (
    <Animated.View entering={enter} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', width: '86%', borderRadius: 26, backgroundColor: '#22102b', paddingBottom: 6 }}>
      <LinearGradient colors={['#55306a', C.plum, C.plum2]} locations={[0, 0.55, 1]} style={{ borderRadius: 26, padding: 14, gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Obj name="shield" size={46} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontFamily: F.mono, fontSize: 10.5, letterSpacing: 1, color: 'rgba(255,255,255,0.75)' }}>{s?.memo?.kind === 'send' ? 'PRIVATE SEND' : 'PRIVATE TIP'} · eERC</Text>
            <Text numberOfLines={1} style={{ fontFamily: F.display, fontSize: 21, lineHeight: 26, color: '#fff' }}>{nameOf(m.who, me)} → {s ? nameOf(s.to, me) : '…'}</Text>
            <Text style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.8)' }}>{ref !== null ? `for call #${ref}` : 'inside the crew'}</Text>
          </View>
          {s && <Avatar address={s.to} size={34} ring="rgba(255,255,255,0.3)" />}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.1)' }}>
          {!c.data ? <View style={{ height: 38, flex: 1, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.08)' }} /> : amount !== null ? (
            <>
              <Text style={{ fontFamily: F.monoBold, fontSize: 22, color: C.mint }}>{toMe ? '+' : ''}{fmt(amount)}</Text>
              <Text style={{ flex: 1, fontSize: 12.5, lineHeight: 17, color: 'rgba(255,255,255,0.85)' }}>tUSDC. Only you, {toMe ? nameOf(m.who) : nameOf(s!.to)} and Kumi's auditor can read this.</Text>
            </>
          ) : (
            <>
              <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' }}><Ic name="lock" size={17} color="#fff" /></View>
              <Text style={{ flex: 1, fontSize: 13, lineHeight: 18, color: 'rgba(255,255,255,0.9)' }}><Text style={{ fontWeight: '800', color: '#fff' }}>Amount hidden.</Text> Snowtrace shows a zk proof and ciphertexts, not a number.</Text>
            </>
          )}
        </View>
        <TxLink hash={m.privateTx!} label="eERC transfer" color="rgba(255,255,255,0.75)" />
      </LinearGradient>
    </Animated.View>
  );
}

/**
 * Sheet for a private tip (from a call card) or a private send to a crewmate. Proves on the device, sends the eERC
 * transfer, then posts the card in the chat.
 */
export function PrivateSendSheet({ me, to, choices, where, title, onClose, onDone }: {
  me: Address; to?: Address; choices?: Address[]; where: Where; title: string; onClose: () => void; onDone: (txs: { hash: string; label: string }[]) => void;
}) {
  const [pick, setPick] = useState<Address | undefined>(to);
  const [amount, setAmount] = useState(where.kind === 'tip' ? '1.00' : '5.00');
  const [done, setDone] = useState<{ hash: string; label: string }[] | null>(null);
  const act = useBusy();
  const mine = useLive(() => readPrivate(me), [me], 0);
  const units = parsePrivate(amount);
  const bal = mine.data?.balance ?? 0n;
  const problem = !mine.data ? null : !mine.data.registered ? 'Open your private balance on the Wallet tab first.'
    : units === null || units === 0n ? 'Enter an amount in tUSDC, like 1.50.'
    : units > bal ? `You have ${fmt(bal)} tUSDC private. Move more in on the Wallet tab.` : !pick ? 'Pick who gets it.' : null;
  return (
    <Sheet title={title} onClose={onClose}>
      {!done ? (
        <>
          {choices && choices.length > 0 && (
            <View style={{ gap: 6 }}>
              <Text style={st.k}>To</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {choices.map(a => (
                  <Pressable key={a} accessibilityRole="button" accessibilityState={{ selected: pick === a }} onPress={() => { tap(); setPick(a); }}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 4, paddingRight: 12, height: 40, borderRadius: 20, backgroundColor: pick === a ? C.plum : '#fff', borderWidth: 2, borderColor: pick === a ? C.plum : C.edge }}>
                    <Avatar address={a} size={30} /><Text style={{ fontWeight: '700', fontSize: 14, color: pick === a ? '#fff' : C.ink }}>{nameOf(a)}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}
          {to && !choices && <View style={[st.row, { padding: 12, borderRadius: 20, backgroundColor: C.plumSoft }]}><Avatar address={to} size={38} /><Text style={{ flex: 1, fontSize: 14.5, color: C.ink }}>To <Text style={{ fontWeight: '800' }}>{nameOf(to)}</Text>{where.ref !== undefined ? ` for call #${where.ref}` : ''}</Text></View>}
          <View style={{ gap: 6 }}>
            <View style={st.between}><Text style={st.k}>Amount (tUSDC)</Text><Text style={{ fontFamily: F.mono, fontSize: 12, color: C.ink2 }}>{mine.data ? `${fmt(bal)} private` : '…'}</Text></View>
            <TextInput testID="private-amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" style={inp} />
          </View>
          <View style={{ gap: 6 }}>
            {[`Prove the send ${PROVER_WHERE} (zk, a few seconds)`, 'Send it on Fuji through the eERC', 'Post the card in this chat'].map((t, i) => (
              <View key={t} style={st.row}><View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: C.plumSoft, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontFamily: F.monoBold, fontSize: 11, color: C.plum }}>{i + 1}</Text></View><Text style={{ fontSize: 13.5, color: C.ink2, flex: 1 }}>{t}</Text></View>
            ))}
          </View>
          <Notice>Snowtrace will show that you sent {pick ? nameOf(pick) : 'them'} something through Kumi's eERC, never how much. Kumi's auditor key can read the amount.</Notice>
          {mine.error && <Notice error>Could not read your private balance: {mine.error}</Notice>}
          {(act.error || (problem && mine.data)) && <Notice error>{act.error ?? problem}</Notice>}
          <Btn testID="confirm-private" title={act.busy ? `${act.busy}…` : `${where.kind === 'tip' ? 'Tip' : 'Send'} ${units ? fmt(units) : ''} privately`} tone="plum" size="lg" icon="lock" busy={act.busy !== null} disabled={!!problem || !mine.data}
            onPress={() => act.run('Starting', async step => { const txs = await sendPrivately(pick!, units!, where, step); yay(); setDone(txs); onDone(txs); })} />
        </>
      ) : (
        <View style={{ gap: 10 }}>
          <Empty scene={art.sticker.hold} alt="A panda hugging a coin" title="Sent privately" body={`${nameOf(pick)} can see the amount on their phone. Everyone else sees the card, not the number.`} />
          {done.map(t => <View key={t.hash} style={st.between}><Text style={{ fontSize: 13.5, color: C.ink }}>{t.label}</Text><TxLink hash={t.hash} /></View>)}
          <Btn title="Back to the chat" tone="plum" onPress={onClose} />
        </View>
      )}
    </Sheet>
  );
}

/** Joins and leaves in a row, as one quiet line ("phone-qa-1, phone-qa-2 joined") so messages and calls lead. */
export function JoinLine({ items, me }: { items: ChatItem[]; me?: string | null }) {
  const joins = items.filter(i => i.kind === 'join').map(i => nameOf(i.who, me));
  const leaves = items.filter(i => i.kind === 'leave').map(i => nameOf(i.who, me));
  const list = (n: string[]) => (n.length > 3 ? `${n.slice(0, 3).join(', ')} +${n.length - 3}` : n.join(', '));
  const parts = [joins.length ? `${list(joins)} joined` : '', leaves.length ? `${list(leaves)} left` : ''].filter(Boolean);
  return (
    <View accessibilityRole="text" style={{ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8 }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: joins.length ? C.mint : C.pink }} />
      <Text numberOfLines={1} style={{ fontSize: 12, color: C.ink3, fontWeight: '600' }}>{parts.join(' · ')}</Text>
    </View>
  );
}
