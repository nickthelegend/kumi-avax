import { useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition, ReduceMotion } from 'react-native-reanimated';
import type { Address } from 'viem';
import { parseDecimal, usd as fmtUsd } from '@kumi-avax/sdk';
import { Text, TextInput } from './T';
import { Sheet, inp } from './Sheet';
import { CountUp, LiveDot } from './Live';
import { Avatar, Btn, Empty, Ic, Notice, Obj, TestTag, TxLink, st, tap, useBusy } from './ui';
import { USDC, nameOf, pub, usdcAbi, useLive } from '../lib/chain';
import { chipIn } from '../lib/actions';
import { C, F, art } from '../lib/theme';

export type Member = { address: Address; shares: bigint };
const ease = LinearTransition.duration(220).reduceMotion(ReduceMotion.System);

/**
 * The crew's fund under the chat header: NAV (live, counts when it changes), who is in and their share of the vote,
 * and Chip in. Tapping it opens the member list with each member's share bar.
 */
export function CrewStrip({ nav, members, totalShares, me, onChip }: { nav: bigint; members: Member[]; totalShares: bigint; me: string | null; onChip: () => void }) {
  const [open, setOpen] = useState(false);
  const sorted = [...members].sort((a, b) => (b.shares > a.shares ? 1 : b.shares < a.shares ? -1 : 0));
  const pct = (s: bigint) => (totalShares > 0n ? Number((s * 1000n) / totalShares) / 10 : 0);
  return (
    <Animated.View layout={ease} style={{ marginHorizontal: 12, marginTop: 10, borderRadius: 24, backgroundColor: C.plumEdge, paddingBottom: 5 }}>
      <View style={{ borderRadius: 24, backgroundColor: C.plum, paddingHorizontal: 14, paddingVertical: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Pressable testID="crew-strip" accessibilityRole="button" accessibilityLabel={`Crew fund ${fmtUsd(nav, 2)} tUSDC, ${members.length} members. ${open ? 'Hide' : 'Show'} members`} onPress={() => { tap(); setOpen(o => !o); }} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}><LiveDot size={6} /><Text style={{ fontSize: 11.5, fontWeight: '700', color: 'rgba(255,255,255,0.72)' }}>Crew fund</Text></View>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4 }}>
                <CountUp value={Number(nav) / 1e6} format={n => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} style={{ fontFamily: F.display, fontSize: 26, lineHeight: 31, color: '#fff' }} />
              </View>
            </View>
            <View style={{ flex: 1, alignItems: 'flex-end', gap: 3 }}>
              <View style={{ flexDirection: 'row' }}>
                {sorted.slice(0, 5).map((m, i) => <View key={m.address} style={{ marginLeft: i ? -9 : 0 }}><Avatar address={m.address} size={28} ring={C.plum} /></View>)}
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                <Text style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.72)', fontWeight: '600' }}>{members.length} {members.length === 1 ? 'member' : 'members'}</Text>
                <View style={{ transform: [{ rotate: open ? '90deg' : '-90deg' }] }}><Ic name="back" size={11} color="rgba(255,255,255,0.72)" /></View>
              </View>
            </View>
          </Pressable>
          <Pressable testID="chip-in" accessibilityRole="button" accessibilityLabel="Chip in tUSDC" onPress={() => { tap(); onChip(); }} style={{ height: 40, paddingHorizontal: 14, borderRadius: 20, backgroundColor: C.butter, borderBottomWidth: 3, borderColor: C.butterEdge, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Ic name="coin" size={16} color={C.plum2} /><Text style={{ fontWeight: '800', fontSize: 13.5, color: C.plum2 }}>Chip in</Text>
          </Pressable>
        </View>
        {open && (
          <Animated.View entering={FadeIn.duration(180).reduceMotion(ReduceMotion.System)} exiting={FadeOut.duration(120).reduceMotion(ReduceMotion.System)} style={{ marginTop: 10, gap: 8 }}>
            {sorted.map(m => (
              <View key={m.address} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Avatar address={m.address} size={24} />
                <View style={{ flex: 1, gap: 3 }}>
                  <View style={st.between}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}><Text style={{ fontSize: 13, fontWeight: '700', color: '#fff' }}>{nameOf(m.address, me)}</Text>{!(me && m.address.toLowerCase() === me.toLowerCase()) && <TestTag address={m.address} onDark />}</View>
                    <Text style={{ fontFamily: F.monoBold, fontSize: 12, color: m.shares > 0n ? C.butter : 'rgba(255,255,255,0.5)' }}>{m.shares > 0n ? `${pct(m.shares).toFixed(1)}% of the vote` : 'not chipped in'}</Text>
                  </View>
                  <View style={{ height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.14)' }}><View style={{ width: `${pct(m.shares)}%`, height: '100%', borderRadius: 3, backgroundColor: me && m.address.toLowerCase() === me.toLowerCase() ? C.coral : C.butter }} /></View>
                </View>
              </View>
            ))}
          </Animated.View>
        )}
      </View>
    </Animated.View>
  );
}

/** Chip in: tUSDC from this phone into the crew vault (approve once, then deposit), shares minted at today's NAV. */
export function ChipInSheet({ crew, me, name, onClose, onDone }: { crew: Address; me: Address; name: string; onClose: () => void; onDone: (txs: { hash: string; label: string }[]) => void }) {
  const [amount, setAmount] = useState('200');
  const [done, setDone] = useState<{ hash: string; label: string }[] | null>(null);
  const act = useBusy();
  const bal = useLive(() => pub.readContract({ address: USDC, abi: usdcAbi, functionName: 'balanceOf', args: [me] }), [me], 8000);
  let units = 0n; try { units = parseDecimal(amount || '0', 6); } catch { units = 0n; }
  const short = bal.data !== undefined && units > bal.data;
  return (
    <Sheet title={`Chip in to ${name}`} onClose={onClose}>
      {!done ? (
        <>
          <View style={st.row}><Obj name="coins" size={56} /><Text style={{ flex: 1, fontSize: 14, color: C.ink2, lineHeight: 20 }}>Your tUSDC goes into the crew's vault and buys shares at today's fund value. Shares are your vote.</Text></View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {['50', '100', '200'].map(a => <Pressable key={a} testID={`chip-${a}`} onPress={() => { tap(); setAmount(a); }} style={{ flex: 1, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: amount === a ? C.butter : '#fff', borderWidth: 2, borderColor: amount === a ? C.butterEdge : C.edge }}><Text style={{ fontFamily: F.monoBold, fontSize: 15, color: C.ink }}>{a}</Text></Pressable>)}
          </View>
          <TextInput testID="chip-amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" style={inp} />
          <Text style={{ fontSize: 13, color: short ? C.pinkInk : C.ink3 }}>Your wallet: {bal.data !== undefined ? `${fmtUsd(bal.data, 2)} tUSDC` : 'reading…'}{short ? ' · not enough' : ''}</Text>
          {act.error && <Notice error>{act.error}</Notice>}
          <Btn testID="confirm-chip" size="lg" tone="butter" icon="coin" disabled={units <= 0n || short} busy={act.busy !== null} title={act.busy ? `${act.busy}…` : `Chip in ${amount} tUSDC`}
            onPress={() => act.run('Signing on this phone', async step => { const txs = await chipIn(crew, units, step); setDone(txs); onDone(txs); })} />
        </>
      ) : (
        <View style={{ gap: 10 }}>
          <Empty scene={art.sticker.party} alt="A bunny jumping in confetti" title={`You chipped in ${amount} tUSDC`} body="The vault holds it as margin on KumiPerps. Now invite your friends." />
          {done.map(t => <View key={t.hash} style={st.between}><Text style={{ fontSize: 13.5, color: C.ink }}>{t.label}</Text><TxLink hash={t.hash} /></View>)}
          <Btn title="Back to the crew" tone="plum" onPress={onClose} />
        </View>
      )}
    </Sheet>
  );
}

/** A new crew's first screen: what to do next, in order. */
export function CrewStart({ chipped, members, onChip, onInvite }: { chipped: boolean; members: number; onChip: () => void; onInvite: () => void }) {
  const steps: [string, string, boolean][] = [
    ['Chip in', 'Put tUSDC in the vault; your shares are your vote.', chipped],
    ['Invite your friends', 'Share the crew link. Each friend sends back a join code.', members > 1],
    ['Pitch a trade', 'Type /long AVAX 2x 10%. It trades when over half the shares vote yes.', false],
  ];
  return (
    <View style={{ alignSelf: 'stretch', borderRadius: 26, backgroundColor: C.edge, paddingBottom: 6 }}>
      <View style={{ borderRadius: 26, backgroundColor: C.panel, borderWidth: 3, borderColor: '#fff', padding: 16, gap: 12 }}>
        <View style={st.row}><Obj name="jar" size={56} /><View style={{ flex: 1 }}><Text style={st.h2}>Your crew is live on Fuji</Text><Text style={{ fontSize: 13.5, color: C.ink2 }}>Three steps to its first trade.</Text></View></View>
        {steps.map(([t, b, ok], i) => (
          <View key={t} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
            <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: ok ? C.mint : C.butter, alignItems: 'center', justifyContent: 'center' }}>{ok ? <Ic name="check" size={14} color="#08311f" /> : <Text style={{ fontFamily: F.monoBold, fontSize: 12, color: C.plum2 }}>{i + 1}</Text>}</View>
            <View style={{ flex: 1 }}><Text style={{ fontWeight: '800', fontSize: 15, color: C.ink, textDecorationLine: ok ? 'line-through' : 'none' }}>{t}</Text><Text style={{ fontSize: 13, color: C.ink2, lineHeight: 18 }}>{b}</Text></View>
          </View>
        ))}
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Btn title="Chip in" tone="butter" icon="coin" onPress={onChip} style={{ flex: 1 }} />
          <Btn title="Invite" tone="plum" icon="qr" onPress={onInvite} style={{ flex: 1 }} />
        </View>
      </View>
    </View>
  );
}
