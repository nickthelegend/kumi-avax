import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { MARKETS, signedUsd, type CallerStat, type Leaderboard } from '@kumi-avax/sdk';
import { Text } from '../../components/T';
import { Screen } from '../../components/Screen';
import { Avatar, Brand, Btn, Card, Empty, Obj, Skeleton, TestTag, st, tap } from '../../components/ui';
import { nameOf } from '../../lib/chain';
import { useBoard } from '../../lib/board';
import { useApp } from '../../lib/store';
import { C, F, art } from '../../lib/theme';

const pct = (v: number | null) => (v === null ? '–' : `${Math.round(v * 100)}%`);
const move = (bps: number | null) => (bps === null ? '–' : `${bps > 0 ? '+' : ''}${(bps / 100).toFixed(2)}%`);
const tone = (n: number | bigint | null) => (n === null || n === 0 || n === 0n ? C.ink2 : n > 0 ? C.mintInk : C.pinkInk);

/** Top callers: ranked from Fuji only (lobby calls at their Chainlink price, Chainlink now, copiers' KumiPerps fills). */
export default function Top() {
  const { address } = useApp();
  const board = useBoard();
  const [scope, setScope] = useState<number | 'all'>('all');
  const [open, setOpen] = useState<string | null>(null);
  const b = board.data;
  const list = b ? (scope === 'all' ? b.global : b.byChannel[scope] ?? []) : [];
  const first = list[0];

  return (
    <Screen tabs>
      <View style={st.between}>
        <Brand size={30} />
        {address && <Avatar address={address} size={42} ring="#fff" />}
      </View>
      <Text style={{ fontWeight: '800', fontSize: 30, lineHeight: 36, color: C.ink, letterSpacing: -0.6 }}>Top callers</Text>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} style={{ marginHorizontal: -16 }}>
        <View style={{ width: 8 }} />
        {([['all', 'All chats'], ...(b?.channels ?? []).map(c => [c.id, c.name] as const)] as const).map(([v, label]) => {
          const on = scope === v;
          return (
            <Pressable key={String(v)} testID={`scope-${v}`} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => { tap(); setScope(v as number | 'all'); setOpen(null); }}
              style={{ height: 38, paddingHorizontal: 15, borderRadius: 999, justifyContent: 'center', backgroundColor: on ? C.plum : '#fff', borderWidth: 2, borderColor: on ? C.plum : C.edge }}>
              <Text style={{ fontWeight: '700', fontSize: 14, color: on ? '#fff' : C.ink2 }}>{label}</Text>
            </Pressable>
          );
        })}
        <View style={{ width: 8 }} />
      </ScrollView>

      {board.error && !b && <Card pad={6}><Empty scene={art.scene.offline} alt="A worried penguin holding an unplugged cable" title="Can't reach Fuji" body={`Could not read the calls: ${board.error}`} action={<Btn title="Try again" tone="plum" size="sm" onPress={board.reload} />} /></Card>}
      {!b && !board.error && <Skeleton rows={4} height={72} />}

      {b && list.length === 0 && <Card pad={6}><Empty scene={art.scene.joinCrew} alt="A frog and a fox welcoming a bunny into a chat bubble" title="No calls here yet" body="Post a trade call in this chat to get on the board." /></Card>}

      {b && first && <Hero s={first} me={address} />}

      {b && list.length > 0 && (
        <Card pad={6}>
          {list.map((s, i) => (
            <Row key={s.who} s={s} b={b} first={i === 0} me={address} open={open === s.who} scope={scope} onPress={() => { tap(); setOpen(open === s.who ? null : s.who); }} />
          ))}
        </Card>
      )}
      {b && <Text style={{ fontSize: 11.5, color: C.ink3, textAlign: 'center' }}>Chainlink at the call vs now · copiers' PnL from KumiPerps fills, before funding · block {b.head.toString()}</Text>}
    </Screen>
  );
}

function Hero({ s, me }: { s: CallerStat; me?: string | null }) {
  return (
    <View style={{ borderRadius: 28, backgroundColor: '#22102b', paddingBottom: 7 }}>
      <LinearGradient colors={['#55306a', C.plum, C.plum2]} locations={[0, 0.55, 1]} style={{ borderRadius: 28, padding: 18, gap: 14, overflow: 'hidden' }}>
        <Image source={(s.avgReturnBps ?? 0) >= 0 ? art.sticker.winFox : art.sticker.hold} accessibilityLabel={(s.avgReturnBps ?? 0) >= 0 ? 'A fox jumping for joy with an up arrow' : 'A panda hugging a coin'} style={{ position: 'absolute', right: -2, top: -8, width: 100, height: 100 }} contentFit="contain" />
        <View style={[st.row, { paddingRight: 96 }]}>
          <View>
            <Avatar address={s.who} size={62} ring="rgba(255,255,255,0.35)" />
            <View style={{ position: 'absolute', top: -16, left: -10, transform: [{ rotate: '-14deg' }] }}><Obj name="crown" size={38} /></View>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontSize: 12.5, fontWeight: '700', color: 'rgba(255,255,255,0.7)' }}>#1 caller</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text numberOfLines={1} style={{ fontFamily: F.display, fontSize: 26, lineHeight: 31, color: '#fff' }}>{nameOf(s.who, me)}</Text>
              <TestTag address={s.who} onDark />
            </View>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Tile k="Win rate" v={pct(s.winRate)} />
          <Tile k="Avg move" v={move(s.avgReturnBps)} />
          <Tile k="Copies" v={String(s.copies)} />
        </View>
        <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)' }}>{s.calls} {s.calls === 1 ? 'call' : 'calls'} · copiers <Text style={{ fontFamily: F.monoBold, color: s.copyPnl >= 0n ? C.mintHi : C.pinkHi }}>{signedUsd(s.copyPnl)} tUSDC</Text></Text>
      </LinearGradient>
    </View>
  );
}

function Tile({ k, v }: { k: string; v: string }) {
  return (
    <View style={{ flex: 1, padding: 10, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.1)' }}>
      <Text style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.65)', fontWeight: '600' }}>{k}</Text>
      <Text style={{ fontFamily: F.monoBold, fontSize: 16, color: '#fff', marginTop: 2 }}>{v}</Text>
    </View>
  );
}

function Row({ s, b, first, me, open, scope, onPress }: { s: CallerStat; b: Leaderboard; first: boolean; me?: string | null; open: boolean; scope: number | 'all'; onPress: () => void }) {
  const calls = b.calls.filter(c => c.who.toLowerCase() === s.who.toLowerCase() && (scope === 'all' || c.channel === scope)).reverse();
  return (
    <View style={{ borderTopWidth: first ? 0 : 1, borderColor: C.line }}>
      <Pressable testID={`caller-${s.rank}`} accessibilityRole="button" accessibilityLabel={`${nameOf(s.who, me)}, rank ${s.rank}`} accessibilityState={{ expanded: open }} onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 10 }}>
        <Text style={{ width: 26, fontFamily: F.monoBold, fontSize: 15, color: s.rank <= 3 ? C.butterInk : C.ink3, textAlign: 'center' }}>{s.rank}</Text>
        <Avatar address={s.who} size={40} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text numberOfLines={1} style={{ fontWeight: '800', fontSize: 15.5, color: C.ink, flexShrink: 1 }}>{nameOf(s.who, me)}</Text>
            <TestTag address={s.who} />
          </View>
          <Text style={{ fontSize: 12.5, color: C.ink2 }}>{s.calls} {s.calls === 1 ? 'call' : 'calls'} · {s.copies} {s.copies === 1 ? 'copy' : 'copies'}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ fontFamily: F.monoBold, fontSize: 16, color: C.ink }}>{pct(s.winRate)}</Text>
          <Text style={{ fontFamily: F.mono, fontSize: 12, color: tone(s.avgReturnBps) }}>{move(s.avgReturnBps)}</Text>
        </View>
      </Pressable>
      {open && (
        <View style={{ paddingHorizontal: 12, paddingBottom: 12, gap: 6 }}>
          {calls.map(c => {
            const m = MARKETS[c.market]!;
            return (
              <View key={`${c.channel}-${c.index}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 14, backgroundColor: c.isLong ? C.coralSoft : C.plumSoft }}>
                <Text style={{ flex: 1, fontSize: 13, color: C.ink }}><Text style={{ fontWeight: '800' }}>{c.isLong ? 'Long' : 'Short'} {m.symbol} {c.leverage}x</Text> · {b.channels[c.channel]?.name} · {c.copies.length} copied</Text>
                <Text style={{ fontFamily: F.monoBold, fontSize: 13, color: tone(c.returnBps) }}>{move(c.returnBps)}</Text>
              </View>
            );
          })}
          <Text style={{ fontSize: 12, color: C.ink2 }}>Copiers: <Text style={{ fontFamily: F.monoBold, color: tone(s.copyPnl) }}>{signedUsd(s.copyPnl)} tUSDC</Text> ({signedUsd(s.copyRealized)} realised)</Text>
        </View>
      )}
    </View>
  );
}
